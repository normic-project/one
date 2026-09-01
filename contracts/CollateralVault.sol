// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Physically isolated backing. Only its market can lock/redeem collateral.
/// No admin, rescue function, fee payment, allowance or arbitrary transfer exists.
contract CollateralVault {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    address public immutable market;
    uint256 public locked;
    error Unauthorized();
    error UnsupportedToken();

    constructor(IERC20 token_) {
        token = token_;
        market = msg.sender;
    }

    modifier onlyMarket() {
        if (msg.sender != market) revert Unauthorized();
        _;
    }

    function lockFrom(address payer, uint256 amount) external onlyMarket {
        uint256 beforeBalance = token.balanceOf(address(this));
        locked += amount;
        token.safeTransferFrom(payer, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBalance != amount) revert UnsupportedToken();
    }

    function release(address to, uint256 amount) external onlyMarket {
        locked -= amount;
        token.safeTransfer(to, amount);
    }
}
