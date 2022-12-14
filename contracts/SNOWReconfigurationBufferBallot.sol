// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import '@openzeppelin/contracts/utils/introspection/ERC165.sol';
import './interfaces/ISNOWReconfigurationBufferBallot.sol';
import './structs/SNOWFundingCycle.sol';

/** 
  @notice 
  Manages approving funding cycle reconfigurations automatically after a buffer period.

  @dev
  Adheres to -
  ISNOWReconfigurationBufferBallot: General interface for the methods in this contract that interact with the blockchain's state according to the protocol's rules.

  @dev
  Inherits from -
  ERC165: Introspection on interface adherance. 
*/
contract SNOWReconfigurationBufferBallot is ERC165, ISNOWReconfigurationBufferBallot {
  //*********************************************************************//
  // ---------------- public immutable stored properties --------------- //
  //*********************************************************************//

  /**
    @notice 
    The number of seconds that must pass for a funding cycle reconfiguration to become either `Approved` or `Failed`.
  */
  uint256 public immutable override duration;

  /**
    @notice
    The contract storing all funding cycle configurations.
  */
  ISNOWFundingCycleStore public immutable override fundingCycleStore;

  //*********************************************************************//
  // --------------------- public stored properties -------------------- //
  //*********************************************************************//

  /**
    @notice 
    The finalized state.

    @dev
    If `Active`, the ballot for the provided configuration can still be finalized whenever its state settles.

    _projectId The ID of the project to check the final ballot state of.
    _configuration The configuration of the funding cycle to check the final ballot state of.
  */
  mapping(uint256 => mapping(uint256 => SNOWBallotState)) public override finalState;

  //*********************************************************************//
  // -------------------------- public views --------------------------- //
  //*********************************************************************//

  /**
    @notice 
    The approval state of a particular funding cycle.

    @param _projectId The ID of the project to which the funding cycle being checked belongs.
    @param _configured The configuration of the funding cycle to check the state of.
    @param _start The start timestamp of the funding cycle to check the state of.

    @return The state of the provided ballot.
  */
  function stateOf(
    uint256 _projectId,
    uint256 _configured,
    uint256 _start
  ) public view override returns (SNOWBallotState) {
    // If there is a finalized state, return it.
    if (finalState[_projectId][_configured] != SNOWBallotState.Active)
      return finalState[_projectId][_configured];

    // If the delay hasn't yet passed, the ballot is either failed or active.
    if (block.timestamp < _configured + duration)
      // If the current timestamp is past the start, the ballot is failed.
      return (block.timestamp >= _start) ? SNOWBallotState.Failed : SNOWBallotState.Active;

    // The ballot is otherwise approved.
    return SNOWBallotState.Approved;
  }

  /**
    @notice
    Indicates if this contract adheres to the specified interface.

    @dev 
    See {IERC165-supportsInterface}.

    @param _interfaceId The ID of the interface to check for adherance to.

    @return A flag indicating if this contract adheres to the specified interface.
  */
  function supportsInterface(bytes4 _interfaceId)
    public
    view
    virtual
    override(ERC165, IERC165)
    returns (bool)
  {
    return
      _interfaceId == type(ISNOWReconfigurationBufferBallot).interfaceId ||
      _interfaceId == type(ISNOWFundingCycleBallot).interfaceId ||
      super.supportsInterface(_interfaceId);
  }

  //*********************************************************************//
  // -------------------------- constructor ---------------------------- //
  //*********************************************************************//

  /**
    @param _duration The number of seconds to wait until a reconfiguration can be either `Approved` or `Failed`.
    @param _fundingCycleStore A contract storing all funding cycle configurations.
  */
  constructor(uint256 _duration, ISNOWFundingCycleStore _fundingCycleStore) {
    duration = _duration;
    fundingCycleStore = _fundingCycleStore;
  }

  //*********************************************************************//
  // ---------------------- external transactions ---------------------- //
  //*********************************************************************//

  /**
    @notice 
    Finalizes a configuration state if the current state has settled.

    @param _projectId The ID of the project to which the funding cycle being checked belongs.
    @param _configured The configuration of the funding cycle to check the state of.

    @return ballotState The state of the finalized ballot. If `Active`, the ballot can still later be finalized when it's state resolves.
  */
  function finalize(uint256 _projectId, uint256 _configured)
    external
    override
    returns (SNOWBallotState ballotState)
  {
    // Get the funding cycle for the configuration in question.
    SNOWFundingCycle memory _fundingCycle = fundingCycleStore.get(_projectId, _configured);

    // Get the current ballot state.
    ballotState = finalState[_projectId][_configured];

    // If the final ballot state is still `Active`.
    if (ballotState == SNOWBallotState.Active) {
      ballotState = stateOf(_projectId, _configured, _fundingCycle.start);
      // If the ballot is active after the cycle has started, it should be finalized as failed.
      if (ballotState != SNOWBallotState.Active) {
        // Store the updated value.
        finalState[_projectId][_configured] = ballotState;

        emit Finalize(_projectId, _configured, ballotState, msg.sender);
      }
    }
  }
}
