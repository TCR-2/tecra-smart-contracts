const { accounts, contract } = require('@openzeppelin/test-environment');

const {
    BN,           // Big Number support
    constants,
    expectEvent,  // Assertions for emitted events
    expectRevert, // Assertions for transactions that should fail
    time,   // for blockchain timestamp manipulations
    balance // for ETH balance checking
} = require('@openzeppelin/test-helpers');

const { ZERO_ADDRESS } = constants;
const { toWei } = require('web3-utils');

// Setup Chai for 'expect' or 'should' style assertions (you only need one)
const { expect } = require('chai');

const Vesting = contract.fromArtifact('InvestorsVestings')

let day = Number(time.duration.days(1))
let week = Number(time.duration.days(7))

let one = toWei('1', 'ether');
let ten = toWei('2', 'ether');
let sto = toWei('100', 'ether');
let tho = toWei('1000', 'ether');

describe('Distribution contract test', function () {

    const [owner, user1, user2, user3, user4] = accounts;
    let vesting, startTime;

    before(async function () {
        vesting = await Vesting.new({ from: owner });
    })

    describe('deploy check', function () {
        it('deployed properly', async function () {
            expect(await vesting.owner()).to.eql(owner, "Ownership fail")
        })
        it('throws on wrong lock config', async function () {
            //function addLock(adddress user,uint startAmount, uint256 totalAmount,uint256 startDate, uint256 endDate)
            startTime = Number(await time.latest())
            await expectRevert(vesting.addLock(user1, one, ten, startTime - 1, startTime + week, { from: owner, value: ten }), "startDate below current time")
            await expectRevert(vesting.addLock(user1, one, ten, startTime + day, startTime + week, { from: user1, value: ten }), "Only for Owner")
            await expectRevert(vesting.addLock(user1, 0, 0, startTime + day, startTime + week, { from: owner, value: '0' }), "Zero amount")
            await expectRevert(vesting.addLock(ZERO_ADDRESS, one, ten, startTime + day, startTime + week, { from: owner, value: ten }), "Zero address")
            await expectRevert(vesting.addLock(user1, one, ten, startTime + week, startTime + day, { from: owner, value: ten }), "Timestamps missconfigured")
        })
        it('add locks', async function () {
            startTime = Number(await time.latest())

            // add lock by addLock()
            // fund locks 3 ETH for 10 days, 2 for 20, 1.5 for 100
            ret = await vesting.addLock(user1, one, toWei('3', 'ether'), String(startTime + 1), String(startTime + (day * 10)), { from: owner, value: toWei('3', 'ether') })
            expectEvent(ret, "LockAdded", {
                user: user1,
                startAmount: one,
                totalAmount: toWei('3', 'ether'),
                startDate: String(startTime + 1),
                endDate: String(startTime + (day * 10))
            })
            await vesting.addLock(user1, 0, toWei('2', 'ether'), String(startTime + (day * 10)), String(startTime + (day * 30)), { from: owner, value: toWei('2', 'ether') })
            await vesting.addLock(user1, 0, toWei('1.5', 'ether'), String(startTime + (day * 30)), String(startTime + (day * 130)), { from: owner, value: toWei('1.5', 'ether') })
            // check last lock
            ret = await vesting.lockedCoins(user1, 2)
            //console.log(ret)
            expect(String(ret.startAmount)).to.eql('0')
            expect(String(ret.totalAmount)).to.eql(toWei('1.5', 'ether'))
            expect(String(ret.startDate)).to.eql(String(startTime + (day * 30)))
            expect(String(ret.endDate)).to.eql(String(startTime + (day * 130)))
            expect(String(ret.claimed)).to.eql("0")

            // add lock by massAddLock()
            // smart locks 1 ETH for 10 days, 0.8 for 20, 0.5 for 100
            la = [user2, user2, user2]
            sa = [0, 0, 0]
            ta = [toWei('1', 'ether'), toWei('0.8', 'ether'), toWei('0.5', 'ether')]
            sd = [String(startTime + 1), String(startTime + (day * 10)), String(startTime + (day * 30))]
            ed = [String(startTime + (day * 10)), String(startTime + (day * 30)), String(startTime + (day * 130))]

            await vesting.massAddLock(la, sa, ta, sd, ed, { from: owner, value: toWei('2.3', 'ether') })

            // dev locks 0.5 ETH for 20 days, 0.5 for 40, 0.5 for 80
            la = [user3, user3, user3]
            sa = [0, 0, 0]
            ta = [toWei('0.5', 'ether'), toWei('0.5', 'ether'), toWei('0.5', 'ether')]
            sd = [String(startTime + 1), String(startTime + (day * 20)), String(startTime + (day * 60))]
            ed = [String(startTime + (day * 20)), String(startTime + (day * 60)), String(startTime + (day * 140))]

            await vesting.massAddLock(la, sa, ta, sd, ed, { from: owner, value: toWei('1.5', 'ether') })
        })
    })
    describe('pay in', function () {
        it('throws on pay by transfer', async function () {
            await expectRevert(vesting.sendTransaction({ from: owner, value: one }),
                "No direct send allowed")
        })
    })
    describe('pay-in readers', function () {
        it('show proper balance', async function () {
            bal = String(await balance.current(vesting.address));
            bal2 = String(await vesting.totalReceived());
            expect(bal).to.eql(bal2);
        })
    })
    describe('claim', function () {
        it('throws when no locks', async function () {
            await expectRevert(vesting.claim({ from: user4 }), "No locks for user")
        })
        it('throws when too early', async function () {
            //await time.increase(1000);
            await expectRevert(vesting.claim({ from: user1 }), "Nothing to claim")
        })
        it('claim proper value in middle', async function () {
            await time.increaseTo(startTime + (day * 5))
            ret = await vesting.claim({ from: user3 })
            expectEvent(ret, "Claimed", {
                user: user3,
                amt: '124999782985985524' //almost toWei('0.125', 'ether')
            })
        })
        it('throws when nothing more to claim', async function () {
            await expectRevert(vesting.claim({ from: user3 }), "Nothing to claim")
        })
        it('claims properly on lock change', async function () {
            await time.increaseTo(startTime + (day * 20))
            ret = await vesting.claim({ from: user2 })
            expectEvent(ret, "Claimed", {
                user: user2,
                amt: toWei('1.4', 'ether') //1+0.8/2
            })
        })
    })

    describe('timestamp change', function () {
        it('update timestamp', async function () {
            ret = await vesting.lockedCoinsOfUser(user1)
            let oldTime = ret[0].endDate;
            await expectRevert(vesting.updateTimestamp(user1, 0, oldTime + 100, { from: owner }), "Can set only earlier")
            await expectRevert(vesting.updateTimestamp(user1, 0, oldTime - 1000), 'Only for Owner')
            await vesting.updateTimestamp(user1, 0, oldTime - 1000, { from: owner })
            ret = await vesting.lockedCoinsOfUser(user1)
            let newTime = ret[0].endDate;
            expect(newTime).to.eql(String(oldTime - 1000))
        })
    })
    describe('address change', function () {
        it('allows change user address by owner', async function () {
            await expectRevert(vesting.replaceUser(user1, user4), "Only for Owner")
            await vesting.replaceUser(user1, user4, { from: owner })
            ret = await vesting.lockedCoinsOfUser(user4)
            expect(ret.length).to.eql(3)
            ret = await vesting.lockedCoinsOfUser(user1)
            expect(ret.length).to.eql(0)

        })
        it('allow claim from new address', async function () {
            ret = await vesting.claim({ from: user4 })
        })
        it('throw when try claim from old address', async function () {
            await expectRevert(vesting.claim({ from: user1 }), "No locks for user")
        })
    })
    describe('Delete user', function () {
        let totalSupply;
        it('allow delete user', async function () {
            totalSupply = await vesting.totalReceived();
            // del user
            await vesting.removeUser(user2, { from: owner })
        })
        it('update storage properly', async function () {
            //check locks
            locks = await vesting.lockedCoinsOfUser(user2)
            expect(locks.length).to.eql(0);
            //check available contract balance
            currSupp = await vesting.totalReceived();
            // user2 locks = 1, 0.8 , 0.5
            sum = new BN(totalSupply).sub(new BN(toWei('1', 'ether')).add(new BN(toWei('0.8', 'ether'))).add(new BN(toWei('0.5', 'ether'))));
            expect(String(currSupp)).to.eql(String(sum))
        })
    })
})
