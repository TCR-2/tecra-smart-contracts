// SPDX-License-Identifier: MIT

pragma solidity ^0.8.6;

contract ownable {
    address public owner;
    address public newOwner;
    event OwnershipChanged(address indexed from, address indexed to);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only for Owner");
        _;
    }

    function giveOwnership(address user) external onlyOwner {
        require(user != address(0x0), "Renounce instead");
        newOwner = user;
    }

    function acceptOwnership() external {
        require(
            newOwner != address(0x0) && msg.sender == newOwner,
            "Only newOwner can accept"
        );
        emit OwnershipChanged(owner, newOwner);
        owner = newOwner;
        newOwner = address(0x0);
    }

    function renounceOwnership() external onlyOwner {
        owner = address(0x0);
    }
}
