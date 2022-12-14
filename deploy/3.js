const { ethers } = require('hardhat');

/**
 * Deploys a new SplitsPayerDeployer that deploys an updated SplitsPayer. This will be executed as a stand-alone procedure with no dependencies.
 *
 * Example usage:
 *
 * npx hardhat deploy --network rinkeby --tag 3
 */
module.exports = async ({ deployments, getChainId }) => {
  console.log("Deploying 3");

  const { deploy } = deployments;
  const [deployer] = await ethers.getSigners();

  let chainId = await getChainId();
  let baseDeployArgs = {
    from: deployer.address,
    log: true
  };

  console.log({ deployer: deployer.address, chain: chainId });

  // Deploy a SNOWETHERC20SplitsPayerDeployer contract.
  await deploy('SNOWETHERC20SplitsPayerDeployer', {
    ...baseDeployArgs,
    skipIfAlreadyDeployed: false,
    contract: "contracts/SNOWETHERC20SplitsPayerDeployer.sol:SNOWETHERC20SplitsPayerDeployer",
    args: [],
  });

  console.log('Done');
};

module.exports.tags = ['3'];