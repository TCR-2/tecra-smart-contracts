// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "./ownable.sol";
import "./reentry.sol";
import "./failsafe.sol";

contract InvestorsVestings is ownable, reentryGuard, failsafe {
    /// total number of coins send to contract, added on make lock()
    uint256 public totalReceived;

    // Locker struct for given address
    struct Coins {
        uint256 startAmount; // coins that can be claimed at start date
        uint256 totalAmount; // total coins to be distributed
        uint256 startDate; // date from which startAmount can be taken
        uint256 endDate; // date to which all totalAmount will be released
        uint256 claimed; // coins already claimed from this lock
    }

    /// storage of locked coins per investor, one might have many different locks
    mapping(address => Coins[]) public lockedCoins;

    event LockAdded(
        address indexed user,
        uint256 startAmount,
        uint256 totalAmount,
        uint256 startDate,
        uint256 endDate
    );
    event Claimed(address indexed user, uint256 amt);

    /**
        Add locked coins storage.
        @param user address of user that can claim from lock
        @param totalAmount total number of coins to be released
        @param startDate timestamp when user can start caliming and get startAmount
        @param endDate timestamp after which totalAmount can be claimed
     */
    function addLock(
        address user,
        uint256 startAmount,
        uint256 totalAmount,
        uint256 startDate,
        uint256 endDate
    ) external payable onlyOwner {
        require(msg.value == totalAmount, "Wrong amount sent.");
        _addLock(
            user,
            startAmount,
            totalAmount,
            startDate,
            endDate,
            block.timestamp
        );
        totalReceived += totalAmount;
    }

    /**
        Add multiple coin locks at one transaction, every can be different
        @param users address list
        @param startAmount list of startAmounts
        @param totalAmount list of totalAmounts
        @param startDate list of startDates
        @param endDate list of endDates
    */
    function massAddLock(
        address[] calldata users,
        uint256[] calldata startAmount,
        uint256[] calldata totalAmount,
        uint256[] calldata startDate,
        uint256[] calldata endDate
    ) external payable onlyOwner {
        uint256 len = users.length;
        require(
            len == startAmount.length &&
                len == totalAmount.length &&
                len == startDate.length &&
                len == endDate.length,
            "Data size mismatch"
        );
        uint256 time = block.timestamp;
        uint256 i;
        uint256 supply;
        for (i; i < len; i++) {
            address user = users[i];
            uint256 amt = totalAmount[i];
            supply += amt;
            _addLock(user, startAmount[i], amt, startDate[i], endDate[i], time);
        }
        require(msg.value == supply, "Wrong amount sent");
        totalReceived += supply;
    }

    function _addLock(
        address user,
        uint256 startAmount,
        uint256 totalAmount,
        uint256 startDate,
        uint256 endDate,
        uint256 time
    ) internal {
        require(user != address(0x0), "Zero address");
        require(totalAmount > 0, "Zero amount");
        require(endDate > startDate, "Timestamps missconfigured");
        require(startDate > time, "startDate below current time");
        Coins memory c = Coins(startAmount, totalAmount, startDate, endDate, 0);
        lockedCoins[user].push(c);
        emit LockAdded(user, startAmount, totalAmount, startDate, endDate);
    }

    /**
        Reader to check kow much coins can be claimed at given moment
        @param user address to calculate
        @return sum number of coins to claim (with 18 decimals)
    */
    function claimable(address user) external view returns (uint256 sum) {
        uint256 len = lockedCoins[user].length;
        if (len > 0) {
            uint256 i;
            for (i; i < len; i++) {
                sum += _claimable(lockedCoins[user][i]);
            }
        }
    }

    function _claimable(Coins memory c) internal view returns (uint256 amt) {
        uint256 time = block.timestamp;
        if (time > c.startDate) {
            if (time > c.endDate) {
                // all coins can be released
                amt = c.totalAmount;
            } else {
                // we need calculate how much can be released
                uint256 pct = ((time - c.startDate) * 1 ether) /
                    (c.endDate - c.startDate);
                amt =
                    c.startAmount +
                    ((c.totalAmount - c.startAmount) * pct) /
                    1 ether;
            }
            amt -= c.claimed; // because some may be already claimed
        }
    }

    /**
       Claim all possible coins for caller
    */
    function claim() external {
        _claim(msg.sender, msg.sender);
    }

    /**
        Claim all possible coins for caller, but send to another address
        @param dest address to where coins will be sent
    */
    function claimTo(address dest) external {
        _claim(msg.sender, dest);
    }

    /**
        Claim all possible coins for given address (pay for fee)
        @param user for which we pay transaction fee
    */
    function claimFor(address user) external {
        _claim(user, user);
    }

    function _claim(address from, address to) internal guarded {
        require(to != address(0x0), "Wrong address");
        uint256 len = lockedCoins[from].length;
        require(len > 0, "No locks for user");
        uint256 sum;
        uint256 i;
        for (i; i < len; i++) {
            Coins storage c = lockedCoins[from][i];
            uint256 amt = _claimable(c);
            c.claimed += amt;
            sum += amt;
        }

        require(sum > 0, "Nothing to claim");
        emit Claimed(from, sum);
        require(payable(to).send(sum), "Transfer failed");
    }

    /**
        All locks of given address in one call
        @param user address to check
        @return tuple of all locks
     */
    function lockedCoinsOfUser(address user)
        public
        view
        returns (Coins[] memory)
    {
        return lockedCoins[user];
    }

    //
    // Special functions TBD
    //

    event UserReplaced(address indexed from, address indexed to);
    event UserRemoved(address indexed user);

    /**
        Replace address authorized to claim locks
        @param from address to be replaced
        @param to new address allowed to claim
     */
    function replaceUser(address from, address to) external onlyOwner {
        require(lockedCoins[from].length > 0, "User have no locks");
        require(lockedCoins[to].length == 0, "User already have locks");
        lockedCoins[to] = lockedCoins[from];
        delete lockedCoins[from];
        emit UserReplaced(from, to);
    }

    /**
        Remove all locks for given user
        @param user address to be cleaned
     */
    function removeUser(address user) external onlyOwner {
        uint256 len = lockedCoins[user].length;
        require(len > 0, "User have no locks");
        uint256 i;
        uint256 amt;
        uint256 claimed;
        for (i; i < len; i++) {
            amt += lockedCoins[user][i].totalAmount;
            claimed += lockedCoins[user][i].claimed;
        }
        totalReceived -= amt;
        delete lockedCoins[user];
        emit UserRemoved(user);
        require(payable(owner).send(amt - claimed), "Refund failed");
    }

    /**
        Update end timestamp - allow to end lock earlier
        @param user address to update
        @param num number of lock
        @param timestamp timestamp to set as endtimestamp
     */
    function updateTimestamp(
        address user,
        uint256 num,
        uint256 timestamp
    ) external onlyOwner {
        Coins storage c = lockedCoins[user][num];
        require(c.endDate > timestamp, "Can set only earlier");
        c.endDate = timestamp;
    }

    /// Revert any direct coin send
    receive() external payable {
        revert("No direct send allowed");
    }
}
