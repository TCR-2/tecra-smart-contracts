// SPDX-License-Identifier: MIT

pragma solidity ^0.8.6;

import "./ownable.sol";
import "./reentry.sol";
import "./failsafe.sol";

contract Distribution is ownable, reentryGuard, failsafe {
    /// total number of coins to be distributed
    uint256 public totalSupply;

    /// total number of coins send to contract
    uint256 public totalReceived;

    constructor(
        address funding,
        address smart,
        address dev,
        uint256 fundLimit,
        uint256 smartLimit,
        uint256 devLimit
    ) ownable() {
        purpose2address[Purpose.tecraFunding] = funding;
        address2purpose[funding] = Purpose.tecraFunding;
        purposeLimit[Purpose.tecraFunding] = fundLimit;

        purpose2address[Purpose.smartDeposit] = smart;
        address2purpose[smart] = Purpose.smartDeposit;
        purposeLimit[Purpose.smartDeposit] = smartLimit;

        purpose2address[Purpose.devTeam] = dev;
        address2purpose[dev] = Purpose.devTeam;
        purposeLimit[Purpose.devTeam] = devLimit;
    }

    enum Purpose {
        dummy, // 0 can be misleading
        tecraFunding,
        smartDeposit,
        devTeam
    }

    // Locker struct for given address
    struct Coins {
        uint256 totalAmount; // total coins to be distributed
        uint256 startDate; // date from which startAmount can be taken
        uint256 endDate; // date to which all totalAmount will be released
        uint256 claimed; // coins already claimed from this lock
    }

    /// Address for given purpose
    mapping(Purpose => address) public purpose2address;
    mapping(address => Purpose) public address2purpose;

    /// Total coins limit per purpose, lowering every claim toward zero
    mapping(Purpose => uint256) public purposeLimit;

    /// storage of locked coins per purpose, one need many different locks
    mapping(Purpose => Coins[]) public lockedCoins;

    /// set to true after configuring all locks, enabling claiming
    bool public locksConfigured;

    event LockAdded(address indexed user, uint256 totalAmount, uint256 endDate);
    event Claimed(address indexed user, uint256 amt);

    /**
    Add locked coins storage.
    @param user address of user that can claim from lock
    @param totalAmount total number of coins to be released
    @param startDate timestamp when user can start caliming and get startAmount
    @param endDate timestamp after which totalAmount can be claimed
     */
    function addLock(
        Purpose user,
        uint256 totalAmount,
        uint256 startDate,
        uint256 endDate
    ) external onlyOwner contractNotConfigured {
        require(user != Purpose.dummy, "Dummy purpose is prohibited");
        require(totalAmount > 0, "Zero amount");
        require(endDate > startDate, "Timestamp missconfigured");
        Coins memory c = Coins(totalAmount, startDate, endDate, 0);
        lockedCoins[user].push(c);
        totalSupply += totalAmount;
        emit LockAdded(purpose2address[user], totalAmount, endDate);
    }

    /**
    Add multiple coin locks at one transaction, every can be different
    @param user purpose to configure
    @param totalAmount list of totalAmounts
    @param startDate list of startDates
    @param endDate list of endDates
    */
    function massAddLock(
        Purpose user,
        uint256[] calldata totalAmount,
        uint256[] calldata startDate,
        uint256[] calldata endDate
    ) external onlyOwner contractNotConfigured {
        require(user != Purpose.dummy, "Dummy purpose is prohibited");
        uint256 len = totalAmount.length;
        require(
            len == startDate.length && len == endDate.length,
            "Data size mismatch"
        );
        uint256 i;
        uint256 supply;
        for (i; i < len; i++) {
            Coins memory c = Coins(totalAmount[i], startDate[i], endDate[i], 0);
            require(c.totalAmount > 0, "Zero amount");
            require(c.endDate > c.startDate, "Timestamp misconfigured");

            lockedCoins[user].push(c);
            supply += c.totalAmount;
            emit LockAdded(purpose2address[user], totalAmount[i], endDate[i]);
        }
        totalSupply += supply;
    }

    /**
    End adding locks, enable claiming
    */
    function endConfiguration() external onlyOwner {
        locksConfigured = true;
    }

    modifier contractConfigured() {
        require(locksConfigured, "Contract not configured");
        _;
    }
    modifier contractNotConfigured() {
        require(!locksConfigured, "Contract already configured");
        _;
    }

    /// Accept coins, incerase counter
    function fund() external payable {
        totalReceived += msg.value;
    }

    /**
    Reader to check kow much coins can be  claimed at given moment
    @param user purpose number to calculate
    @return sum number of coins to claim (with 18 decimals)
    */
    function canClaim(Purpose user)
        external
        view
        contractConfigured
        returns (uint256 sum)
    {
        uint256 len = lockedCoins[user].length;
        if (len > 0) {
            uint256 i;
            for (i; i < len; i++) {
                sum += _claimable(lockedCoins[user][i]);
            }
        }
        if (sum > purposeLimit[user]) return purposeLimit[user];
    }

    function _claimable(Coins memory c) internal view returns (uint256 amt) {
        uint256 time = block.timestamp;
        if (c.startDate < time) {
            if (time > c.endDate) {
                // all coins can be released
                amt = c.totalAmount;
            } else {
                // we need calculate how much can be released
                uint256 pct = ((time - c.startDate) * 1 ether) /
                    (c.endDate - c.startDate);
                amt = (c.totalAmount * pct) / 1 ether;
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

    function _claim(address purpose, address to)
        internal
        contractConfigured
        guarded
    {
        Purpose from = address2purpose[purpose];
        require(from != Purpose.dummy && to != address(0x0), "Wrong address");
        uint256 len = lockedCoins[from].length;
        require(len > 0, "No locks for purpose");
        uint256 sum;
        uint256 i;
        for (i; i < len; i++) {
            Coins storage c = lockedCoins[from][i];
            uint256 amt = _claimable(c);
            c.claimed += amt;
            sum += amt;
        }
        // hard limit
        if (sum > purposeLimit[from]) {
            sum = purposeLimit[from];
        }
        purposeLimit[from] -= sum;
        require(sum > 0, "Nothing to claim");
        emit Claimed(purpose, sum);
        require(payable(to).send(sum), "Transfer failed");
    }

    /**
        Update purpose address
        @param num purpose enum
        @param newAddress new address for purpose
     */
    function updatePurpose(Purpose num, address newAddress) external onlyOwner {
        address old = purpose2address[num];
        delete address2purpose[old];
        purpose2address[num] = newAddress;
        address2purpose[newAddress] = num;
    }

    /// Revert any direct coin send
    receive() external payable {
        revert("No direct send allowed");
    }
}
