import { expect } from 'chai';
import { ethers } from 'hardhat';
import { deployMockContract } from '@ethereum-waffle/mock-contract';
import { packFundingCycleMetadata, makeSplits } from '../helpers/utils';

import snowAllocator from '../../artifacts/contracts/interfaces/ISNOWSplitAllocator.sol/ISNOWSplitAllocator.json';
import snowDirectory from '../../artifacts/contracts/SNOWDirectory.sol/SNOWDirectory.json';
import snowFundingCycleStore from '../../artifacts/contracts/SNOWFundingCycleStore.sol/SNOWFundingCycleStore.json';
import snowOperatoreStore from '../../artifacts/contracts/SNOWOperatorStore.sol/SNOWOperatorStore.json';
import snowProjects from '../../artifacts/contracts/SNOWProjects.sol/SNOWProjects.json';
import snowSplitsStore from '../../artifacts/contracts/SNOWSplitsStore.sol/SNOWSplitsStore.json';
import snowToken from '../../artifacts/contracts/SNOWToken.sol/SNOWToken.json';
import snowTokenStore from '../../artifacts/contracts/SNOWTokenStore.sol/SNOWTokenStore.json';

describe('SNOWController::distributeReservedTokensOf(...)', function () {
  const PROJECT_ID = 1;
  const MEMO = 'Test Memo';
  const RESERVED_AMOUNT = 20000;
  const PREFERED_CLAIMED_TOKEN = true;

  let MINT_INDEX;
  let RESERVED_SPLITS_GROUP;

  before(async function () {
    let snowOperationsFactory = await ethers.getContractFactory('SNOWOperations');
    let snowOperations = await snowOperationsFactory.deploy();
    MINT_INDEX = await snowOperations.MINT();

    let snowSplitsGroupsFactory = await ethers.getContractFactory('SNOWSplitsGroups');
    let snowSplitsGroups = await snowSplitsGroupsFactory.deploy();
    RESERVED_SPLITS_GROUP = await snowSplitsGroups.RESERVED_TOKENS();
  });

  async function setup() {
    let [deployer, projectOwner, ...addrs] = await ethers.getSigners();

    const blockNum = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNum);
    const timestamp = block.timestamp;

    let [
      mockJbAllocator,
      mockJbDirectory,
      mockJbFundingCycleStore,
      mockJbOperatorStore,
      mockJbProjects,
      mockSplitsStore,
      mockJbToken,
      mockJbTokenStore,
    ] = await Promise.all([
      deployMockContract(deployer, snowAllocator.abi),
      deployMockContract(deployer, snowDirectory.abi),
      deployMockContract(deployer, snowFundingCycleStore.abi),
      deployMockContract(deployer, snowOperatoreStore.abi),
      deployMockContract(deployer, snowProjects.abi),
      deployMockContract(deployer, snowSplitsStore.abi),
      deployMockContract(deployer, snowToken.abi),
      deployMockContract(deployer, snowTokenStore.abi),
    ]);

    let snowControllerFactory = await ethers.getContractFactory(
      'contracts/SNOWController.sol:SNOWController',
    );
    let snowController = await snowControllerFactory.deploy(
      mockJbOperatorStore.address,
      mockJbProjects.address,
      mockJbDirectory.address,
      mockJbFundingCycleStore.address,
      mockJbTokenStore.address,
      mockSplitsStore.address,
    );

    await Promise.all([
      mockJbProjects.mock.ownerOf.withArgs(PROJECT_ID).returns(projectOwner.address),
      mockJbDirectory.mock.isTerminalOf.withArgs(PROJECT_ID, projectOwner.address).returns(false),
      mockJbFundingCycleStore.mock.currentOf.withArgs(PROJECT_ID).returns({
        number: 1,
        configuration: timestamp,
        basedOn: timestamp,
        start: timestamp,
        duration: 0,
        weight: 0,
        discountRate: 0,
        ballot: ethers.constants.AddressZero,
        metadata: packFundingCycleMetadata({ reservedRate: 10000, allowMinting: 1 }),
      }),

      mockJbTokenStore.mock.totalSupplyOf.withArgs(PROJECT_ID).returns(0),
    ]);

    await snowController
      .connect(projectOwner)
      .mintTokensOf(
        PROJECT_ID,
        RESERVED_AMOUNT,
        ethers.constants.AddressZero,
        MEMO,
        PREFERED_CLAIMED_TOKEN,
        /*useReservedRate*/ true,
      );

    return {
      projectOwner,
      addrs,
      snowController,
      mockJbAllocator,
      mockJbOperatorStore,
      mockJbDirectory,
      mockJbFundingCycleStore,
      mockJbTokenStore,
      mockJbToken,
      mockSplitsStore,
      mockJbProjects,
      timestamp,
    };
  }

  it(`Should send to beneficiaries and emit events if beneficiaries are set in split, but not allocator or project id`, async function () {
    const { addrs, projectOwner, snowController, mockJbTokenStore, mockSplitsStore, timestamp } =
      await setup();
    const caller = addrs[0];
    const splitsBeneficiariesAddresses = [addrs[1], addrs[2]].map((signer) => signer.address);

    const splits = makeSplits({
      count: 2,
      beneficiary: splitsBeneficiariesAddresses,
      preferClaimed: true,
    });

    await mockSplitsStore.mock.splitsOf
      .withArgs(PROJECT_ID, timestamp, RESERVED_SPLITS_GROUP)
      .returns(splits);

    await Promise.all(
      splitsBeneficiariesAddresses.map(async (beneficiary) => {
        await mockJbTokenStore.mock.mintFor
          .withArgs(
            beneficiary,
            PROJECT_ID,
            /*amount=*/ Math.floor(RESERVED_AMOUNT / splitsBeneficiariesAddresses.length),
            PREFERED_CLAIMED_TOKEN,
          )
          .returns();
      }),
    );

    expect(
      await snowController.connect(caller).callStatic.distributeReservedTokensOf(PROJECT_ID, MEMO),
    ).to.equal(RESERVED_AMOUNT);

    const tx = await snowController.connect(caller).distributeReservedTokensOf(PROJECT_ID, MEMO);

    // Expect one event per split + one event for the whole transaction
    await Promise.all([
      splits.map(async (split) => {
        await expect(tx)
          .to.emit(snowController, 'DistributeToReservedTokenSplit')
          .withArgs(
            PROJECT_ID,
            /*domain=*/ timestamp,
            /*splitsGroup.RESERVED_TOKEN=*/ RESERVED_SPLITS_GROUP,
            [
              split.preferClaimed,
              split.preferAddToBalance,
              split.percent,
              split.projectId,
              split.beneficiary,
              split.lockedUntil,
              split.allocator,
            ],
            /*count=*/ RESERVED_AMOUNT / splits.length,
            /*caller=*/ caller.address,
          );
      }),
      await expect(tx)
        .to.emit(snowController, 'DistributeReservedTokens')
        .withArgs(
          /*fundingCycleConfiguration=*/ timestamp,
          /*fundingCycleNumber=*/ 1,
          PROJECT_ID,
          /*projectOwner=*/ projectOwner.address,
          /*count=*/ RESERVED_AMOUNT,
          /*leftoverTokenCount=*/ 0,
          MEMO,
          caller.address,
        ),
    ]);
  });

  it(`Should send to the project owner and emit events if project id is set in split, but not allocator`, async function () {
    const {
      addrs,
      projectOwner,
      snowController,
      mockJbTokenStore,
      mockSplitsStore,
      mockJbProjects,
      timestamp,
    } = await setup();
    const caller = addrs[0];
    const splitsBeneficiariesAddresses = [addrs[1], addrs[2]].map((signer) => signer.address);
    const otherProjectId = 2;
    const otherProjectOwner = addrs[3];

    const splits = makeSplits({
      count: 2,
      beneficiary: splitsBeneficiariesAddresses,
      preferClaimed: true,
      projectId: otherProjectId,
    });

    await mockJbProjects.mock.ownerOf.withArgs(otherProjectId).returns(otherProjectOwner.address);

    await mockSplitsStore.mock.splitsOf
      .withArgs(PROJECT_ID, timestamp, RESERVED_SPLITS_GROUP)
      .returns(splits);

    await mockJbTokenStore.mock.mintFor
      .withArgs(
        otherProjectOwner.address,
        PROJECT_ID,
        Math.floor(RESERVED_AMOUNT / splitsBeneficiariesAddresses.length),
        true,
      )
      .returns();

    expect(
      await snowController.connect(caller).callStatic.distributeReservedTokensOf(PROJECT_ID, MEMO),
    ).to.equal(RESERVED_AMOUNT);

    const tx = await snowController.connect(caller).distributeReservedTokensOf(PROJECT_ID, MEMO);

    await Promise.all([
      splits.map(async (split, _) => {
        await expect(tx)
          .to.emit(snowController, 'DistributeToReservedTokenSplit')
          .withArgs(
            PROJECT_ID,
            /*domain=*/ timestamp,
            /*splitsGroup.RESERVED_TOKEN=*/ RESERVED_SPLITS_GROUP,
            [
              split.preferClaimed,
              split.preferAddToBalance,
              split.percent,
              split.projectId,
              split.beneficiary,
              split.lockedUntil,
              split.allocator,
            ],
            /*count=*/ RESERVED_AMOUNT / splits.length,
            /*caller=*/ caller.address,
          );
      }),
      await expect(tx)
        .to.emit(snowController, 'DistributeReservedTokens')
        .withArgs(
          /*fundingCycleConfiguration=*/ timestamp,
          /*fundingCycleNumber=*/ 1,
          PROJECT_ID,
          /*projectOwner=*/ projectOwner.address,
          /*count=*/ RESERVED_AMOUNT,
          /*leftoverTokenCount=*/ 0,
          MEMO,
          caller.address,
        ),
    ]);
  });

  it(`Should send to the allocators and emit events if they are set in splits`, async function () {
    const {
      addrs,
      projectOwner,
      snowController,
      mockJbTokenStore,
      mockSplitsStore,
      mockJbAllocator,
      mockJbToken,
      timestamp,
    } = await setup();
    const caller = addrs[0];
    const splitsBeneficiariesAddresses = [addrs[1], addrs[2]].map((signer) => signer.address);
    const otherProjectId = 2;

    const splits = makeSplits({
      count: 2,
      beneficiary: splitsBeneficiariesAddresses,
      preferClaimed: true,
      allocator: mockJbAllocator.address,
      projectId: otherProjectId,
    });

    await mockSplitsStore.mock.splitsOf
      .withArgs(PROJECT_ID, timestamp, RESERVED_SPLITS_GROUP)
      .returns(splits);

    await mockJbTokenStore.mock.mintFor
      .withArgs(
        mockJbAllocator.address,
        PROJECT_ID,
        /*amount=*/ Math.floor(RESERVED_AMOUNT / splitsBeneficiariesAddresses.length),
        PREFERED_CLAIMED_TOKEN,
      )
      .returns();

    await mockJbTokenStore.mock.tokenOf.withArgs(PROJECT_ID).returns(mockJbToken.address);

    await Promise.all(
      splits.map(async (split) => {
        await mockJbAllocator.mock.allocate
          .withArgs({
            // SNOWSplitAllocationData obj
            token: mockJbToken.address,
            amount: Math.floor(RESERVED_AMOUNT / splits.length),
            decimals: 18,
            projectId: PROJECT_ID,
            group: RESERVED_SPLITS_GROUP,
            split,
          })
          .returns();
      }),
    );

    expect(
      await snowController.connect(caller).callStatic.distributeReservedTokensOf(PROJECT_ID, MEMO),
    ).to.equal(RESERVED_AMOUNT);

    const tx = await snowController.connect(caller).distributeReservedTokensOf(PROJECT_ID, MEMO);

    await Promise.all([
      splits.map(async (split, _) => {
        await expect(tx)
          .to.emit(snowController, 'DistributeToReservedTokenSplit')
          .withArgs(
            PROJECT_ID,
            /*domain=*/ timestamp,
            /*splitsGroup.RESERVED_TOKEN=*/ RESERVED_SPLITS_GROUP,
            [
              split.preferClaimed,
              split.preferAddToBalance,
              split.percent,
              split.projectId,
              split.beneficiary,
              split.lockedUntil,
              split.allocator,
            ],
            /*count=*/ RESERVED_AMOUNT / splits.length,
            /*caller=*/ caller.address,
          );
      }),
      await expect(tx)
        .to.emit(snowController, 'DistributeReservedTokens')
        .withArgs(
          /*fundingCycleConfiguration=*/ timestamp,
          /*fundingCycleNumber=*/ 1,
          PROJECT_ID,
          /*projectOwner=*/ projectOwner.address,
          /*count=*/ RESERVED_AMOUNT,
          /*leftoverTokenCount=*/ 0,
          MEMO,
          caller.address,
        ),
    ]);
  });

  it(`Should send to the msg.sender and emit events if no allocator, beneficiary or project id is set in split`, async function () {
    const { addrs, projectOwner, snowController, mockJbTokenStore, mockSplitsStore, timestamp } =
      await setup();
    const caller = addrs[0];
    const splits = makeSplits({ count: 2, preferClaimed: true });

    await mockSplitsStore.mock.splitsOf
      .withArgs(PROJECT_ID, timestamp, RESERVED_SPLITS_GROUP)
      .returns(splits);

    await Promise.all(
      splits.map(async () => {
        await mockJbTokenStore.mock.mintFor
          .withArgs(
            caller.address,
            PROJECT_ID,
            /*amount=*/ Math.floor(RESERVED_AMOUNT / splits.length),
            PREFERED_CLAIMED_TOKEN,
          )
          .returns();
      }),
    );

    expect(
      await snowController.connect(caller).callStatic.distributeReservedTokensOf(PROJECT_ID, MEMO),
    ).to.equal(RESERVED_AMOUNT);

    const tx = await snowController.connect(caller).distributeReservedTokensOf(PROJECT_ID, MEMO);

    // Expect one event per split + one event for the whole transaction
    await Promise.all([
      splits.map(async (split) => {
        await expect(tx)
          .to.emit(snowController, 'DistributeToReservedTokenSplit')
          .withArgs(
            PROJECT_ID,
            /*domain=*/ timestamp,
            /*splitsGroup.RESERVED_TOKEN=*/ RESERVED_SPLITS_GROUP,
            [
              split.preferClaimed,
              split.preferAddToBalance,
              split.percent,
              split.projectId,
              split.beneficiary,
              split.lockedUntil,
              split.allocator,
            ],
            /*count=*/ RESERVED_AMOUNT / splits.length,
            /*caller=*/ caller.address,
          );
      }),
      await expect(tx)
        .to.emit(snowController, 'DistributeReservedTokens')
        .withArgs(
          /*fundingCycleConfiguration=*/ timestamp,
          /*fundingCycleNumber=*/ 1,
          PROJECT_ID,
          /*projectOwner=*/ projectOwner.address,
          /*count=*/ RESERVED_AMOUNT,
          /*leftoverTokenCount=*/ 0,
          MEMO,
          caller.address,
        ),
    ]);
  });

  it(`Should send all left-over tokens to the project owner and emit events`, async function () {
    const { addrs, projectOwner, snowController, mockJbTokenStore, mockSplitsStore, timestamp } =
      await setup();
    const caller = addrs[0];
    const splitsBeneficiariesAddresses = [addrs[1], addrs[2]].map((signer) => signer.address);

    const splits = makeSplits({
      count: 2,
      beneficiary: splitsBeneficiariesAddresses,
      preferClaimed: true,
      redemptionRate: 0,
    });

    splits[1].percent = 0; // A total of 50% is now allocated

    await mockSplitsStore.mock.splitsOf
      .withArgs(PROJECT_ID, timestamp, RESERVED_SPLITS_GROUP)
      .returns(splits);

    await mockJbTokenStore.mock.mintFor
      .withArgs(
        splitsBeneficiariesAddresses[0],
        PROJECT_ID,
        /*amount*/ Math.floor(RESERVED_AMOUNT / splitsBeneficiariesAddresses.length),
        PREFERED_CLAIMED_TOKEN,
      )
      .returns();

    await mockJbTokenStore.mock.mintFor
      .withArgs(splitsBeneficiariesAddresses[1], PROJECT_ID, /*amount=*/ 0, PREFERED_CLAIMED_TOKEN)
      .returns();

    await mockJbTokenStore.mock.mintFor
      .withArgs(
        projectOwner.address,
        PROJECT_ID,
        /*amount*/ Math.floor(RESERVED_AMOUNT / splitsBeneficiariesAddresses.length),
        /*preferedClaimedToken=*/ false,
      )
      .returns();

    expect(
      await snowController.connect(caller).callStatic.distributeReservedTokensOf(PROJECT_ID, MEMO),
    ).to.equal(RESERVED_AMOUNT);

    const tx = await snowController.connect(caller).distributeReservedTokensOf(PROJECT_ID, MEMO);

    // Expect one event per non-null split + one event for the whole transaction
    await Promise.all([
      await expect(tx)
        .to.emit(snowController, 'DistributeToReservedTokenSplit')
        .withArgs(
          PROJECT_ID,
          /*domain=*/ timestamp,
          /*splitsGroup.RESERVED_TOKEN=*/ RESERVED_SPLITS_GROUP,
          [
            splits[0].preferClaimed,
            splits[0].preferAddToBalance,
            splits[0].percent,
            splits[0].projectId,
            splits[0].beneficiary,
            splits[0].lockedUntil,
            splits[0].allocator,
          ],
          /*count=*/ RESERVED_AMOUNT / splitsBeneficiariesAddresses.length,
          caller.address,
        ),
      await expect(tx)
        .to.emit(snowController, 'DistributeReservedTokens')
        .withArgs(
          /*fundingCycleConfiguration=*/ timestamp,
          /*fundingCycleNumber=*/ 1,
          PROJECT_ID,
          projectOwner.address,
          /*count=*/ RESERVED_AMOUNT,
          /*leftoverTokenCount=*/ RESERVED_AMOUNT / splitsBeneficiariesAddresses.length,
          MEMO,
          caller.address,
        ),
    ]);
  });

  it(`Should not revert and emit events if called with 0 tokens in reserve`, async function () {
    const { addrs, snowController, mockJbTokenStore, mockSplitsStore, timestamp } = await setup();

    const caller = addrs[0];
    const splitsBeneficiariesAddresses = [addrs[1], addrs[2]].map((signer) => signer.address);

    const splits = makeSplits({
      count: 2,
      beneficiary: splitsBeneficiariesAddresses,
      preferClaimed: true,
    });

    await mockSplitsStore.mock.splitsOf
      .withArgs(PROJECT_ID, timestamp, RESERVED_SPLITS_GROUP)
      .returns(splits);

    await Promise.all(
      splitsBeneficiariesAddresses.map(async (beneficiary) => {
        await mockJbTokenStore.mock.mintFor
          .withArgs(
            beneficiary,
            PROJECT_ID,
            /*amount*/ Math.floor(RESERVED_AMOUNT / splitsBeneficiariesAddresses.length),
            PREFERED_CLAIMED_TOKEN,
          )
          .returns();
      }),
    );

    await snowController.connect(caller).distributeReservedTokensOf(PROJECT_ID, MEMO);

    await mockJbTokenStore.mock.totalSupplyOf.withArgs(PROJECT_ID).returns(RESERVED_AMOUNT);

    expect(
      await snowController.reservedTokenBalanceOf(PROJECT_ID, /*RESERVED_RATE=*/ 10000),
    ).to.equal(0);

    await expect(snowController.connect(caller).distributeReservedTokensOf(PROJECT_ID, MEMO)).to.be
      .not.reverted;
  });
});
