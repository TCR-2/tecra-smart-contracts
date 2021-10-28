const { accounts, contract } = require('@openzeppelin/test-environment');

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

const Distribution = contract.fromArtifact('Distribution')

let day = Number(time.duration.days(1))
let week = Number(time.duration.days(7))

describe('Distribution contract test', function () {

    const [owner, user1, user2, funding, smart, dev] = accounts;
    let dist, startTime;
    let fundLimit = toWei('5', 'ether')
    let smartLimit = toWei('2', 'ether')
    let devLimit = toWei('1', 'ether')
    let Purpose = []; //emulate enum
    Purpose.dummy = 0;
    Purpose.tecraFunding = 1;
    Purpose.smartDeposit = 2;
    Purpose.devTeam = 3;

    before(async function () {
        dist = await Distribution.new(funding, smart, dev, fundLimit, smartLimit, devLimit, { from: owner });

    })

    describe('deploy check', function () {
        it('deployed properly', async function () {
            expect(await dist.owner()).to.eql(owner, "Ownership fail")
            expect(await dist.locksConfigured()).to.eql(false, 'impos-si-bru!')
            expect(String(await dist.purposeLimit(Purpose.tecraFunding))).to.eql(fundLimit)
            expect(String(await dist.purposeLimit(Purpose.smartDeposit))).to.eql(smartLimit)
            expect(String(await dist.purposeLimit(Purpose.devTeam))).to.eql(devLimit)
            expect(String(await dist.purposeLimit(Purpose.dummy))).to.eql("0")
            await expectRevert(dist.claim({ from: dev }), "Contract not configured")
        })
        it('add locks', async function () {
            //function addLock(Purpose user,uint256 totalAmount,uint256 startDate, uint256 endDate)
            await expectRevert(dist.addLock(Purpose.dummy, fundLimit, 1, 2, { from: owner }), "Dummy purpose is prohibited")
            await expectRevert(dist.addLock(Purpose.dummy, fundLimit, 1, 2, { from: user1 }), "Only for Owner")
            startTime = Number(await time.latest())

            // add lock by addLock()
            // fund locks 3 ETH for 10 days, 2 for 20, 1.5 for 100
            ret = await dist.addLock(Purpose.tecraFunding, toWei('3', 'ether'), String(startTime), String(startTime + (day * 10)), { from: owner })
            expectEvent(ret, "LockAdded", {
                user: funding,
                totalAmount: toWei('3', 'ether'),
                endDate: String(startTime + (day * 10))
            })
            await dist.addLock(Purpose.tecraFunding, toWei('2', 'ether'), String(startTime + (day * 10)), String(startTime + (day * 30)), { from: owner })
            await dist.addLock(Purpose.tecraFunding, toWei('1.5', 'ether'), String(startTime + (day * 30)), String(startTime + (day * 130)), { from: owner })
            // check last lock
            ret = await dist.lockedCoins(Purpose.tecraFunding, 2)
            //console.log(ret)
            expect(String(ret.totalAmount)).to.eql(toWei('1.5', 'ether'))
            expect(String(ret.startDate)).to.eql(String(startTime + (day * 30)))
            expect(String(ret.endDate)).to.eql(String(startTime + (day * 130)))
            expect(String(ret.claimed)).to.eql("0")

            // mess with dates
            await expectRevert(dist.addLock(Purpose.tecraFunding, toWei('1', 'ether'), String(startTime + (day * 10)), String(startTime), { from: owner }), "Timestamp missconfigured")

            // add lock by massAddLock()
            // smart locks 1 ETH for 10 days, 0.8 for 20, 0.5 for 100
            ta = [toWei('1', 'ether'), toWei('0.8', 'ether'), toWei('0.5', 'ether')]
            sd = [String(startTime), String(startTime + (day * 10)), String(startTime + (day * 30))]
            ed = [String(startTime + (day * 10)), String(startTime + (day * 30)), String(startTime + (day * 130))]

            await dist.massAddLock(Purpose.smartDeposit, ta, sd, ed, { from: owner })

            // dev locks 0.5 ETH for 20 days, 0.5 for 40, 0.5 for 80
            ta = [toWei('0.5', 'ether'), toWei('0.5', 'ether'), toWei('0.5', 'ether')]
            sd = [String(startTime), String(startTime + (day * 20)), String(startTime + (day * 60))]
            ed = [String(startTime + (day * 20)), String(startTime + (day * 60)), String(startTime + (day * 140))]

            await dist.massAddLock(Purpose.devTeam, ta, sd, ed, { from: owner })
        })
    })
    describe('pay in', function () {
        it('accepts pay-in via function', async function () {
            val = new BN(fundLimit).add(new BN(devLimit)).add(new BN(smartLimit))
            await dist.fund({ from: owner, value: val })
            expect(String(await dist.totalReceived())).to.eql(String(val))
        })
        it('throws on pay by transfer', async function () {
            await expectRevert.unspecified(dist.sendTransaction({ from: owner, value: fundLimit }))
        })
    })
    describe('pay-in readers', function () {
        it('show proper balance', async function () {
            bal = String(await balance.current(dist.address));
            bal2 = String(await dist.totalReceived());
            expect(bal).to.eql(bal2);
        })
    })
    describe('claim', function () {
        it('throws when too early', async function () {
            await expectRevert(dist.claim({ from: dev }), "Contract not configured")
            await dist.endConfiguration({ from: owner })
            expect(await dist.locksConfigured()).to.eql(true)

        })
        it('claim proper value in middle', async function () {
            await time.increaseTo(startTime + (day * 5))
            ret = await dist.claim({ from: dev })
            expectEvent(ret, "Claimed", {
                user: dev,
                amt: toWei('0.125', 'ether')
            })
        })
        it('throws when nothing more to claim', async function () {
            await dist.claim({ from: funding })
            await expectRevert(dist.claim({ from: funding }), "Nothing to claim")
        })
        it('claims properly on lock change', async function () {
            await time.increaseTo(startTime + (day * 20))
            ret = await dist.claim({ from: smart })
            expectEvent(ret, "Claimed", {
                user: smart,
                amt: toWei('1.4', 'ether') //1+0.8/2
            })
        })
    })
    describe('limit', function () {
        it('claim to hard limit', async function () {
            await time.increaseTo(startTime + (day * 100))
            ret = await dist.claim({ from: dev })
            // devLimit - 0.125 claimed earlier
            val = new BN(devLimit).sub(new BN(toWei('0.125', 'ether')))
            expectEvent(ret, "Claimed", {
                user: dev,
                amt: String(val)
            })
        })
    })
    describe('address change', function () {
        it('allows change purpose address', async function () {
            await expectRevert(dist.updatePurpose(Purpose.tecraFunding, user1), "Only for Owner")
            await dist.updatePurpose(Purpose.tecraFunding, user1, { from: owner })
            expect(await dist.purpose2address(Purpose.tecraFunding)).to.eql(user1)
        })
        it('allow claim from new address', async function () {
            ret = await dist.claim({ from: user1 })
        })
        it('throw when try claim from old address', async function () {
            await expectRevert(dist.claim({ from: funding }), "Wrong address")
        })
        it('throw when try claim form unregistered address', async function () {
            await expectRevert(dist.claim({ from: user2 }), "Wrong address")
        })
    })
})
