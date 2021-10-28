// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

contract HashTest {
    function calcHash(
        uint256 amount,
        uint256 depositLength,
        uint256 reward,
        uint256 timeLimit
    ) external view returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    msg.sender,
                    amount,
                    depositLength,
                    reward,
                    timeLimit
                )
            );
    }
}
