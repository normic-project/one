// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Shared types keep resolution modules independent from the trading engine.
interface IResolutionModule {
    enum MarketType { AUTO_MARKET, EVENT_MARKET }
    enum Outcome { NONE, YES, NO, INVALID }
    enum MarketState { OPEN, CLOSED, PROPOSED, DISPUTED, RESOLVED_YES, RESOLVED_NO, RESOLVED_INVALID }
    enum Condition { ABOVE_OR_EQUAL, BELOW }

    struct Metadata {
        string question;
        string yesOutcome;
        string noOutcome;
        string category;
        string rules;
        string primarySource;
        string secondarySource;
        string metadataURI;
    }

    struct AutoTerms {
        uint128 threshold;
        uint64 closesAt;
        uint64 resolvesAt;
        Condition condition;
    }

    function describe(AutoTerms calldata terms) external view returns (Metadata memory);
    function outcome(AutoTerms calldata terms) external view returns (Outcome);
}
