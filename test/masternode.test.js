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

const Masternode = contract.fromArtifact('Masternode')

let day = Number(time.duration.days(1))
let week = Number(time.duration.days(7))
let half = toWei('0.5', 'ether')
let two = toWei('2', 'ether')
let mnAmount = toWei('10000', 'ether')
let three = toWei('3', 'ether')

describe('Tecra Masternode Contract', function () {
    const [owner, user1, user2, user3, user4, backend, user5] = accounts;
    let MN;
    let start;
    let stages = [];

    before(async function () {
        let timeNow = await time.latest();
        start = Number(timeNow);
        // stage [end, daily amt]
        stages = [[start + week, toWei('1', 'ether')], [start + week * 2, two], [start + week * 3, three]]
        MN = await Masternode.new(stages, { from: owner });
    });

    it('deployed correctly', async function () {
        expect(await MN.owner()).to.be.equal(owner, 'wrong owner');
        expect(String(await MN.MN_AMOUNT())).to.be.eql(toWei('10000', 'ether'), "wrong amount");
        expect(String(await MN.ActiveMasternodes())).to.be.eql('0', "wrong mn number")
    });

    it('send funds', async function () {
        await expectRevert(MN.fund({ from: user1, value: half }), "Only for Owner")
        ret = await MN.fund({ from: owner, value: toWei('50', 'ether') })
        expectEvent(ret, "Funded", {
            amount: toWei('50', 'ether')
        })
    })
    describe('add MN', function () {
        it('throws on bad amount', async function () {
            // to little
            await expectRevert(MN.createMN({ value: half, from: user1 }), "Need exactly 10'000 coins")
            // to much
            await expectRevert(MN.createMN({ value: two, from: user1 }), "Need exactly 10'000 coins")
        })
        it('add masternodes', async function () {
            ret = await MN.createMN({ value: mnAmount, from: user1 })
            expectEvent(ret, "MasternodeAdded", {
                user: user1
            })
            expect(String(await MN.ActiveMasternodes())).to.eql('1', "not registered")
            await MN.createMN({ value: mnAmount, from: user2 })
            await MN.createMN({ value: mnAmount, from: user3 })
            await MN.createMN({ value: mnAmount, from: user4 })
            expect(String(await MN.ActiveMasternodes())).to.eql('4', "not registered")
        })
    });

    describe('calculation', function () {
        it('throw if to soon', async function () {
            await MN.calculateOnce();
            ret = await MN.getCalculations();
            expect(String(ret)).to.eql('1');
            await expectRevert(MN.calculate(), "Too early");
        })
        it('create calc events', async function () {
            // day and 10 seconds later
            await time.increaseTo(start + day + 10);
            await MN.calculate();
            ret = await MN.getCalculations();
            expect(String(ret)).to.eql('2');
            // get timestamp
            prev = await MN.calculations(1);
            prevTS = String(prev.timestamp);
            await time.increase(day);
            await MN.calculate();
            curr = await MN.calculations(2);
            currTS = String(curr.timestamp)
            // week later it should be day
            expect(Number(new BN(currTS).sub(new BN(prevTS)))).to.eql(day)
        })
    })
    describe('claim', function () {
        it('claim correctly', async function () {
            ret = await MN.claim({ from: user1 })
            expectEvent(ret, "Claimed", {
                user: user1,
                amount: '750000000000000000' // 3 events, 1 of 4 mn = 3*0.25 = 0.75
            })
            ret = await MN.claim({ from: user2 })
            expectEvent(ret, "Claimed", {
                user: user2,
                amount: '750000000000000000' // 3 events 1 of 4 mn
            })
        })
        it('throws if nothing to claim', async function () {
            await expectRevert(MN.claim({ from: owner }), "Not a masternode owner");
            await expectRevert(MN.claim({ from: user1 }), "Nothing to claim");
        })
        it('claim from many MNs', async function () {
            ret = await MN.claim({ from: user3 })
            expectEvent(ret, 'Claimed', {
                user: user3,
                amount: '750000000000000000' // 3 events 1 of 4 mn
            })
            await MN.createMN({ from: user3, value: mnAmount })
            await MN.createMN({ from: user3, value: mnAmount })
            await MN.createMN({ from: user3, value: mnAmount })
            await time.increase(day);
            await MN.calculate();
            ret = await MN.claim({ from: user3 })
            expectEvent(ret, "Claimed", {
                user: user3,
                amount: '571428571428571428' // 4MN of 7, one event = 0.571428...
            })
        })
        it('Calc check', async function () {
            await time.increase(day);
            await MN.calculate();// 5th event
            ret = await MN.claim({ from: user4 })
            expectEvent(ret, "Claimed", {
                user: user4,
                amount: '1035714285714285714' // 3 * 1/4 + 2* 1/7 = 1,03571428571...
            })

        })
    })

    describe('remove', function () {
        it('remove correctly', async function () {
            // claim anything
            await MN.claim({ from: user1 })
            //remove and pay back
            przed = String(await balance.current(user1));
            ret = await MN.removeMN({ from: user1 })
            expectEvent(ret, "MasternodeRemoved", {
                user: user1
            })
            fee = String(new BN(ret.receipt.gasUsed).mul(new BN(toWei('20', 'gwei'))))
            po = String(await balance.current(user1))
            expect(po).to.eql(String(new BN(przed).add(new BN(mnAmount).sub(new BN(fee)))), "refund failed")
        })
        it('throws when nothing to remove', async function () {
            // never have MN
            await expectRevert(MN.removeMN({ from: owner }), "Not MN owner")
            // MN removed
            await expectRevert(MN.removeMN({ from: user1 }), "Not MN owner")
        })

    })

    describe('backend functions', function () {
        it('throws when not backend address', async function () {
            // claim and add functions are not limited
            // backend not set
            await expectRevert(MN.removeMasternodeFor(user5, { from: backend }), "Only for Backend")
            await MN.updateBackend(backend, { from: owner })
            // call from different address
            await expectRevert(MN.removeMasternodeFor(user5, { from: owner }), "Only for Backend")
        })
        it('add mn for user', async function () {
            // someone pay for mn creation
            ret = await MN.createMasternodeFor(user5, { value: mnAmount, from: backend })
            expectEvent(ret, "MasternodeAdded", {
                user: user5
            })

        })
        it('claim for user', async function () {
            await time.increase(day);
            // someone pay fee for claiming
            await MN.calculate();
            ret = await MN.claimFor(user5, { from: backend })
            expectEvent(ret, "Claimed", {
                user: user5,
                amount: '142857142857142857' // 1/7 = 0,142857142857....
            })
        })
        it('remove for user', async function () {
            // backend can remove MN for user paying fee
            amt1 = await balance.current(user5)
            ret = await MN.removeMasternodeFor(user5, { from: backend })
            expectEvent(ret, 'MasternodeRemoved', {
                user: user5
            })
            amt2 = await balance.current(user5)
            expect(String(amt2)).to.eql(String(new BN(amt1).add(new BN(mnAmount))), "Payback fail")
        })

    })

    describe('many calculations', function () {
        it('make many calculations in one call', async function () {
            num = await MN.getCalculations();
            await time.increase(week)
            await MN.calculate();
            num2 = await MN.getCalculations();
            expect(String(num2)).to.eql(String(new BN(num).add(new BN('7'))))
        })
        it('show timestamp of last calc', async function () {
            num = await MN.getLastCalculationTimestamp();
            await time.increase(day);
            await MN.calculate();
            num2 = await MN.getLastCalculationTimestamp();
            expect(String(num2)).to.eql(String(new BN(num).add(new BN(day))))
        })
    })

});
