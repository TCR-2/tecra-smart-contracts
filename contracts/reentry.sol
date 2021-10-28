// SPDX-License-Identifier: MIT

pragma solidity ^0.8.6;

contract reentryGuard {
    uint256 constant ENTERED = 1;
    uint256 constant NOT_ENTERED = 2;
    uint256 entered = NOT_ENTERED;
    modifier guarded() {
        require(entered == NOT_ENTERED, "Re-entry triggered");
        entered = ENTERED;
        _;
        entered = NOT_ENTERED;
    }
}
