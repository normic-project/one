// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IMarketTypes {
    enum Outcome { NONE, YES, NO, INVALID }
    enum MarketState { OPEN, CLOSED, RESOLVED_YES, RESOLVED_NO, RESOLVED_INVALID }

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
}
