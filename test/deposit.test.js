const { accounts, contract, privateKeys, web3 } = require('@openzeppelin/test-environment');

const {
    BN,           // Big Number support
    expectEvent,  // Assertions for emitted events
    expectRevert, // Assertions for transactions that should fail
    time,   // for blockchain timestamp manipulations
    balance // for ETH balance checking
} = require('@openzeppelin/test-helpers');

const { toWei } = require('web3-utils');

// Setup Chai for 'expect' or 'should' style assertions (you only need one)
const { expect } = require('chai');

const Deposit = contract.fromArtifact('SmartDeposit')
const HashTest = contract.fromArtifact('HashTest')

let day = Number(time.duration.days(1))
let week = Number(time.duration.days(7))

describe('Smart deposit test', function () {

    const [backend, owner, user1, user2, user3] = accounts;
    const [privBackend] = privateKeys;
    let depo;
    let ht;
    before(async function () {
        depo = await Deposit.new({ from: owner });
        ht = await HashTest.new();
    })

    describe('configure/fund', function () {
        it('runs', async function () {
            ret = await depo.fund({ from: owner, value: toWei('50', 'ether') })
            expect(String(await depo.rewardsAvailable())).to.eql(toWei('50', 'ether'))
            await depo.updateBackend(backend, { from: owner })
            expect(await depo.backend()).to.eql(backend)
        })

    })
    describe('deposit', function () {

        it('deposit via signature', async function () {
            /**
                abi.encodePacked(
                msg.sender,
                amount,
                depositLength,
                reward,
                timeLimit)
             */

            var timeNow = Number(await time.latest())
            var amount = toWei('1', 'ether')
            var depositLength = String(week);
            var reward = toWei('1', 'ether');
            var timeLimit = String(timeNow + 120);
            data = web3.utils.soliditySha3({ t: "address", v: user1 },
                { t: "uint256", v: amount },
                { t: "uint256", v: depositLength },
                { t: "uint256", v: reward },
                { t: "uint256", v: timeLimit })
            signature = web3.eth.accounts.sign(data, privBackend)
            var { v, r, s } = signature;
            /** function deposit(uint256 amount,
             * uint256 depositLength,
             * uint256 reward,
             * uint256 timeLimit,
             * uint8 v,
             * bytes32 r,
             * bytes32 s
            */
            ret = await depo.deposit(
                amount, depositLength, reward, timeLimit, v, r, s,
                { from: user1, value: amount })
            var endDate = String(timeNow + Number(depositLength))
            expectEvent(ret, "DepositStarted", {
                user: user1,
                amount: amount,
                endDate: endDate
            })

            await expectRevert(depo.deposit(
                amount, depositLength, reward, timeLimit, v, r, s,
                { from: user1, value: amount }),
                "Deposit already made")

        })

        it('deposit as backend', async function () {
            var timeNow = Number(await time.latest())
            var amount = toWei('1', 'ether')
            var depositLength = week * 2;
            var reward = toWei('0.5', 'ether')
            var timeLimit = timeNow - 10;
            await expectRevert(
                depo.depositFor(user1, amount, depositLength, reward, timeLimit,
                    { value: amount, from: backend }),
                "Too late!")
            var timeLimit = timeNow + 360;
            await expectRevert(
                depo.depositFor(user1, amount, depositLength, reward, timeLimit,
                    { value: amount, from: user1 }),
                "Only for backend")
            await expectRevert(
                depo.depositFor(user1, amount, depositLength, reward, timeLimit,
                    { value: reward, from: backend }),
                "Wrong amount")

            //timeNow = Number(await time.latest())
            ret = await depo.depositFor(
                user1, amount, depositLength, reward, timeLimit,
                { value: amount, from: backend })
            expectEvent(ret, "DepositStarted", {
                user: user1,
                amount: amount,
                endDate: String(timeNow + depositLength)
            })
            await depo.depositFor(
                user2, amount, depositLength, reward, timeLimit,
                { value: amount, from: backend })
        })

    })

    describe('readers', function () {
        it('shows deposit by index', async function () {
            ret = await depo.deposits(user1, 1);
            //console.log(ret)
            expect(String(ret.amount)).to.eql(toWei('1', 'ether'))
            //expect(ret.endDate).to.eql()
            expect(String(ret.reward)).to.eql(toWei('0.5', 'ether'))

        })
        it('dumps all deposits', async function () {
            ret = await depo.depositsOf(user1);
            //console.log(ret)
            expect(ret.length).to.eql(2)
        })
    })

    describe('claim', function () {
        it('throw when no deposit', async function () {
            await time.increase(day);
            await expectRevert(depo.claim({ from: user3 }), "No deposits for user");
        })
        it('trow when too early', async function () {
            await expectRevert(depo.claim({ from: user1 }), "Nothing to claim");
        })
        it('claim after full time', async function () {
            await time.increase(week);
            ret = await depo.claim({ from: user1 })
            expectEvent(ret, "DepositEnded", {
                user: user1,
                amount: toWei('2', 'ether')
            })
        })
    })
    describe('break', function () {

        it('pay back on break', async function () {
            curr = await depo.rewardsAvailable();
            ret = await depo.breakDeposit('0', { from: user1 });
            expectEvent(ret, "DepositBroken", {
                user: user1,
                amount: toWei('1', 'ether')
            })
            after = await depo.rewardsAvailable();
            expect(String(after)).to.eql(String(new BN(curr).add(new BN(toWei('0.5', 'ether')))))
        })
        it('throws when can be claimed', async function () {
            await time.increase(week);
            await expectRevert(depo.breakDeposit('0', { from: user2 }), "Use claim")
            await depo.claim({ from: user2 })
        })
    })

    describe('storage tests', async function () {
        var left1, left2
        it('prepare storage', async function () {
            // set of storage for one user
            // length: week, day, 2 days, 2 weeks, 3 days, 3 weeks, week
            let timeNow = Number(await time.latest())
            let day = Number(time.duration.days(1))
            let day2 = Number(time.duration.days(2))
            let day3 = Number(time.duration.days(3))
            let week = Number(time.duration.days(7))
            let week2 = Number(time.duration.days(14))
            let week3 = Number(time.duration.days(21))
            let one = toWei('1', 'ether')

            await depo.depositFor(user2, one, week, one, timeNow + 30,
                { value: one, from: backend });
            await depo.depositFor(user2, one, day, one, timeNow + 30,
                { value: one, from: backend })
            await depo.depositFor(user2, one, day2, one, timeNow + 30,
                { value: one, from: backend })
            await depo.depositFor(user2, one, week2, one, timeNow + 30,
                { value: one, from: backend })
            await depo.depositFor(user2, one, day3, one, timeNow + 30,
                { value: one, from: backend })
            await depo.depositFor(user2, one, week3, one, timeNow + 30,
                { value: one, from: backend })
            await depo.depositFor(user2, one, week, one, timeNow + 30,
                { value: one, from: backend })
            ret = await depo.depositsOf(user2)
            //console.log(ret)
            expect(ret.length).to.eql(7)
            left1 = ret[3] // 2 weeks
            left2 = ret[5] // 3 weeks

        })
        it('move storage on claimOne', async function () {
            // after a day
            // claimOne 2nd - day
            await time.increase(day + 1)
            ret = await depo.depositsOf(user2)
            let lastOne = ret[6];
            ret = await depo.claimOne(user2, user2, '1', { from: backend })
            expectEvent(ret, "DepositEnded", {
                user: user2,
                amount: toWei('2', 'ether')
            })
            ret = await depo.depositsOf(user2)
            expect(ret.length).to.eql(6);
            expect(ret[1]).to.eql(lastOne)

        })
        it('move storage on break', async function () {
            // day later
            // break 5th - 3 days
            await time.increase(day)
            ret = await depo.depositsOf(user2)
            lastOne = ret[5];
            ret = await depo.breakDeposit('4', { from: user2 })
            expectEvent(ret, "DepositBroken", {
                user: user2,
                amount: toWei('1', 'ether')
            })
            ret = await depo.depositsOf(user2)
            expect(ret.length).to.eql(5);
            expect(ret[4]).to.eql(lastOne)
        })
        it('move storage on claim', async function () {
            // week later
            // claim 3 at once
            // only two left - 2 weeks, 3 weeks
            await time.increase(week)
            ret = await depo.claim({ from: user2 })
            expectEvent(ret, "DepositEnded", {
                user: user2,
                amount: toWei('6', 'ether')
            })
            ret = await depo.depositsOf(user2)
            expect(ret.length).to.eql(2);
            expect(ret[0]).to.eql(left2)
            expect(ret[1]).to.eql(left1)
        })
    })
})