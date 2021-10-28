// SPDX-License-Identifier: MIT

pragma solidity ^0.8.6;

import "./ownable.sol";

contract failsafe is ownable {
    function recoverERC20(address token) external onlyOwner {
        IERC20 t = IERC20(token);
        uint256 amount = t.balanceOf(address(this));
        require(amount > 0, "Nothing to recover");
        t.transfer(msg.sender, amount);
    }
}

interface IERC20 {
    function balanceOf(address user) external returns (uint256 amount);

    function transfer(address dest, uint256 amount) external returns (bool);
}
