// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Whole shares and 1-cent price ticks make all fees EXACT in 6-decimal USDG.
library TradeMath {
    uint256 internal constant UNIT = 1_000_000;
    uint256 internal constant MAX_SHARES = 1_000_000_000_000;
    error InvalidOrderSize();
    error InvalidPrice();

    function validate(uint256 shares, uint256 price) internal pure {
        if (shares == 0 || shares > MAX_SHARES) revert InvalidOrderSize();
        if (price == 0 || price >= 100) revert InvalidPrice();
    }

    function quote(uint256 shares, uint256 price) internal pure
        returns (uint256 principal, uint256 protocolFee, uint256 creatorFee)
    {
        principal = shares * price * 10_000;
        protocolFee = principal * 4 / 1000;
        creatorFee = principal * 6 / 1000;
    }
}
