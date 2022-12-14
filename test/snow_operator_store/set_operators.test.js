import { expect } from 'chai';
import { ethers } from 'hardhat';

import { makePackedPermissions } from '../helpers/utils';

describe('SNOWOperatorStore::setOperators(...)', function () {
  const DOMAIN = 1;
  const DOMAIN_2 = 2;
  const PERMISSION_INDEXES_EMPTY = [];
  const PERMISSION_INDEXES_1 = [1, 2, 3];
  const PERMISSION_INDEXES_2 = [4, 5, 6];

  async function setup() {
    let [deployer, projectOwner, ...addrs] = await ethers.getSigners();

    let snowOperatorStoreFactory = await ethers.getContractFactory('SNOWOperatorStore');
    let snowOperatorStore = await snowOperatorStoreFactory.deploy();

    return {
      projectOwner,
      deployer,
      addrs,
      snowOperatorStore,
    };
  }

  function makeOperator(operator, domain, permissionIndexes) {
    return {
      address: operator.address,
      domain: domain,
      permissionIndexes: permissionIndexes,
      packedPermissionIndexes: makePackedPermissions(permissionIndexes),
    };
  }

  async function setOperators(snowOperatorStore, operators, deployer) {
    const t = await snowOperatorStore
      .connect(deployer)
      .setOperators(
        operators.map((operator) => [
          operator.address,
          operator.domain,
          operator.permissionIndexes,
        ]),
      );

    return t;
  }

  async function validateEvents(snowOperatorStore, tx, operators, deployer) {
    await Promise.all(
      operators.map(async (operator, _) => {
        await expect(tx)
          .to.emit(snowOperatorStore, 'SetOperator')
          .withArgs(
            /*operator=*/ operator.address,
            /*account=*/ deployer.address,
            /*operator.domain=*/ operator.domain,
            /*operator.permissionIndexes=*/ operator.permissionIndexes,
            /*operator._packed*/ operator.packedPermissionIndexes,
          );

        expect(
          await snowOperatorStore.permissionsOf(
            /*operator=*/ operator.address,
            /*account=*/ deployer.address,
            /*domain*/ operator.domain,
          ),
        ).to.equal(operator.packedPermissionIndexes);
      }),
    );
  }

  async function setOperatorsAndValidateEvents(snowOperatorStore, operators, deployer) {
    let tx = await setOperators(snowOperatorStore, operators, deployer);
    await validateEvents(snowOperatorStore, tx, operators, deployer);
  }

  it('Set with no previous values, then override and clear them', async function () {
    const { projectOwner, deployer, addrs, snowOperatorStore } = await setup();

    let operators = [
      makeOperator(/*operator=*/ addrs[1], DOMAIN, PERMISSION_INDEXES_1),
      makeOperator(/*operator=*/ addrs[2], DOMAIN, PERMISSION_INDEXES_1),
      makeOperator(/*operator=*/ addrs[3], DOMAIN, PERMISSION_INDEXES_1),
    ];
    await setOperatorsAndValidateEvents(snowOperatorStore, operators, deployer);

    operators = [
      makeOperator(/*operator=*/ projectOwner, DOMAIN, PERMISSION_INDEXES_2),
      makeOperator(/*operator=*/ addrs[1], DOMAIN, PERMISSION_INDEXES_2),
      makeOperator(/*operator=*/ addrs[2], DOMAIN, PERMISSION_INDEXES_2),
    ];
    await setOperatorsAndValidateEvents(snowOperatorStore, operators, deployer);

    operators = [
      makeOperator(/*operator=*/ projectOwner, DOMAIN, PERMISSION_INDEXES_EMPTY),
      makeOperator(/*operator=*/ addrs[1], DOMAIN, PERMISSION_INDEXES_EMPTY),
      makeOperator(/*operator=*/ addrs[2], DOMAIN, PERMISSION_INDEXES_EMPTY),
    ];
    await setOperatorsAndValidateEvents(snowOperatorStore, operators, deployer);
  });

  it('Same operator used for two different projects', async function () {
    const { deployer, projectOwner, snowOperatorStore } = await setup();

    let operators = [
      makeOperator(/*operator=*/ projectOwner, DOMAIN, PERMISSION_INDEXES_1),
      makeOperator(/*operator=*/ projectOwner, DOMAIN_2, PERMISSION_INDEXES_1),
    ];
    await setOperatorsAndValidateEvents(snowOperatorStore, operators, deployer);
  });

  it('Same operator used for the same project', async function () {
    const { deployer, projectOwner, snowOperatorStore } = await setup();
    let operators = [
      makeOperator(/*operator=*/ projectOwner, DOMAIN, PERMISSION_INDEXES_1),
      makeOperator(/*operator=*/ projectOwner, DOMAIN, PERMISSION_INDEXES_2),
    ];
    let tx = await setOperators(snowOperatorStore, operators, deployer);
    await validateEvents(snowOperatorStore, tx, operators.slice(1), deployer);
  });
});
