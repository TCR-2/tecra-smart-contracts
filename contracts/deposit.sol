// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "./ownable.sol";
import "./reentry.sol";
import "./failsafe.sol";

contract SmartDeposit is ownable, reentryGuard, failsafe {
    /// Rewards available in contract
    uint256 public rewardsAvailable;

    // address of backend signer/caller
    address public backend;

    // Event when SmartDeposit is set
    event DepositStarted(address indexed user, uint256 amount, uint256 endDate);
    // Event when SmartDeposit is ended on time
    event DepositEnded(address indexed user, uint256 amount);
    // Event when SmartDeposit is ended too early
    event DepositBroken(address indexed user, uint256 amount);

    // Struct holds deposit data
    struct Deposit {
        uint256 amount;
        uint256 endDate;
        uint256 reward;
    }

    /// Deposits of users
    mapping(address => Deposit[]) public deposits;

    // disallow use same signed deposit more than once
    mapping(bytes32 => bool) internal usedHashes;

    /**
        Create SmartDeposit via dapp and backend signature
        @param amount amount of coins in deposit
        @param depositLength how long after transaction deposit is rewarded
        @param reward reward after deposit period
        @param timeLimit timestamp to which this signed deposit can be made
        @param v part of signature
        @param r part of signature
        @param s part of signature
     */
    function deposit(
        uint256 amount,
        uint256 depositLength,
        uint256 reward,
        uint256 timeLimit,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external payable {
        require(msg.value == amount, "Wrong amount send");
        require(block.timestamp < timeLimit, "Signature too old");
        require(rewardsAvailable >= reward, "Not enough rewards deposited");
        bytes32 hash = keccak256(
            abi.encodePacked(
                msg.sender,
                amount,
                depositLength,
                reward,
                timeLimit
            )
        );
        require(!usedHashes[hash], "Deposit already made");
        usedHashes[hash] = true;
        _verifySignature(hash, v, r, s);
        uint256 endDate = block.timestamp + depositLength;
        deposits[msg.sender].push(Deposit(amount, endDate, reward));
        rewardsAvailable -= reward;
        emit DepositStarted(msg.sender, amount, endDate);
    }

    /**
        Create deposit directly from backend
        @param user addres of user
        @param amount coins to deposit
        @param depositLength how long until user can claim reward
        @param reward to be paid after end date
        @param timeLimit how long transaction can be processed by blockchain
     */
    function depositFor(
        address user,
        uint256 amount,
        uint256 depositLength,
        uint256 reward,
        uint256 timeLimit
    ) external payable {
        require(backend != address(0), "Backend not configured");
        require(msg.sender == backend, "Only for backend");
        require(msg.value == amount, "Wrong amount send");
        require(rewardsAvailable >= reward, "Not enough rewards deposited");
        uint256 timeNow = block.timestamp;
        require(timeNow < timeLimit, "Too late!");
        uint256 endDate = timeNow + depositLength;
        deposits[user].push(Deposit(amount, endDate, reward));
        rewardsAvailable -= reward;
        emit DepositStarted(user, amount, endDate);
    }

    /**
        Claim ended deposits and rewards
     */
    function claim() external {
        _claim(msg.sender, msg.sender);
    }

    /**
        Claim ended deposits for other user - caller pay tx fee
        @param user address to claim and send rewards
     */
    function claimFor(address user) external {
        _claim(user, user);
    }

    /**
        Claim own coins to antoher address
        @param dest address to which all coins will be sent
     */
    function claimTo(address dest) external {
        _claim(msg.sender, dest);
    }

    /**
        Backend can claim any user to any address
        @param user address to claim
        @param dest address to send coins
     */
    function claimFromTo(address user, address dest) external {
        require(backend != address(0), "Backend not configured");
        require(msg.sender == backend, "Only for backend");
        _claim(user, dest);
    }

    /**
        Iterate through user deposits and get matured ones
        @param from address to claim
        @param to address to send coins
     */
    function _claim(address from, address to) internal {
        uint256 len = deposits[from].length;
        require(len > 0, "No deposits for user");
        uint256 i;
        uint256 amt;
        uint256 timeNow = block.timestamp;
        if (len > 1) {
            //more than one deposit from user
            while (i < deposits[from].length) {
                Deposit storage d = deposits[from][i]; //cheaper, as we not always read full struct
                if (timeNow > d.endDate) {
                    amt += d.reward + d.amount;
                    uint256 last = deposits[from].length - 1;
                    if (i < last) {
                        deposits[from][i] = deposits[from][last];
                    }
                    deposits[from].pop();
                } else {
                    i++;
                }
            }
        } else {
            //only one deposit
            Deposit storage d = deposits[from][i];
            if (timeNow > d.endDate) {
                amt = d.reward + d.amount;
                deposits[from].pop();
            }
        }
        if (amt > 0) {
            require(payable(to).send(amt), "Send failed");
            emit DepositEnded(from, amt);
        } else {
            revert("Nothing to claim");
        }
    }

    /**
        Emergency claim one of deposits
        Can be used in case of many deposits from one user that fail out-of-gas because loop
     */
    function claimOne(
        address user,
        address dest,
        uint256 idx
    ) external {
        require(msg.sender == backend, "Only for backend");
        uint256 len = deposits[user].length;
        require(idx < len, "Wrong index");
        Deposit storage d = deposits[user][idx];
        require(block.timestamp > d.endDate, "Too soon, use breakDeposit");
        uint256 amt = d.amount + d.reward;
        if (idx < len - 1) {
            deposits[user][idx] = deposits[user][len - 1];
        }
        deposits[user].pop();
        require(payable(dest).send(amt), "Transfer failed");
        emit DepositEnded(user, amt);
    }

    /**
        Read reward that can be calimed for user on current date from all his deposits
        @param user address to check
        @return reward amount of coins possible to claim
     */
    function claimableReward(address user)
        external
        view
        returns (uint256 reward)
    {
        uint256 len = deposits[user].length;
        if (len > 0) {
            uint256 timeNow = block.timestamp;
            uint256 i;
            for (i; i < len; i++) {
                Deposit storage d = deposits[user][i];
                if (timeNow > d.endDate) {
                    reward += d.reward;
                }
            }
        }
    }

    /// Return all user deposits as tuple
    function depositsOf(address user) external view returns (Deposit[] memory) {
        return deposits[user];
    }

    /**
        Break Smart Deposit before time, return only deposit, no reward
        @param num number of users deposit (0 if only one made)
     */
    function breakDeposit(uint256 num) external {
        uint256 len = deposits[msg.sender].length;
        require(num < len, "Wrong index");
        require(
            deposits[msg.sender][num].endDate > block.timestamp,
            "Use claim!"
        );
        uint256 amt = deposits[msg.sender][num].amount;
        rewardsAvailable += deposits[msg.sender][num].reward;
        if (num < len - 1) {
            deposits[msg.sender][num] = deposits[msg.sender][len - 1];
        }
        deposits[msg.sender].pop();
        require(payable(msg.sender).send(amt), "Send failed");
        emit DepositBroken(msg.sender, amt);
    }

    /**
        Set/update backend address
        @param _backend address
     */
    function updateBackend(address _backend) external onlyOwner {
        backend = _backend;
    }

    // signature checking, throw if check failed
    function _verifySignature(
        bytes32 hash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal view {
        require(backend != address(0), "Backend not configured");
        bytes32 digest = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)
        );
        address signer = ecrecover(digest, v, r, s);
        require(signer == backend, "Wrong signature");
    }

    /**
        Fund contract witch coins for rewards
     */
    function fund() external payable onlyOwner {
        rewardsAvailable += msg.value;
    }

    /// Deny any direct send
    receive() external payable {
        revert("Contract disallow direct send");
    }
}
