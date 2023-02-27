import { Wallet, providers, utils } from "ethers"
import { formatEther, parseTransaction } from 'ethers/lib/utils'
import MevFlood from "mev-flood"
import Prompt from "prompt-sync"
const prompt = Prompt()

const admin = new Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
const provider = new providers.JsonRpcProvider("http://localhost:8545", {chainId: 5, name: "anvil"})
const userWallets = [...Array(10)].map(i => Wallet.createRandom())
const deployFile = "./deployment.json"

async function standard() {

    let flood: MevFlood
    try {
        // load existing deployment
        flood = await new MevFlood(admin, provider).withDeploymentFile(deployFile)
    } catch (e) {
        
        // spin up new deployment
        flood = new MevFlood(admin, provider)
        await flood.fundWallets(
            userWallets.map(wallet => wallet.address),
            13
        )
        console.log("funded wallets")

        // deploy liquidity
        await flood.liquid({
            wethMintAmountAdmin: 50,
            wethMintAmountUser: 1,
        }, userWallets[0])

        // write deployment to file
        await flood.saveDeployment(deployFile)
    }

    console.log("weth", flood.deployment?.weth.contractAddress)

    // flood will save the deployment internally
    // use existing deployment to mint DAI for more wallets
    for (const wallet of userWallets) {
        await flood.liquid({
            shouldApproveTokens: true,
            shouldDeploy: false,
            shouldBootstrapLiquidity: false,
            shouldMintTokens: true,
            wethMintAmountAdmin: 0,
            wethMintAmountUser: 5,
        }, wallet)
    }

    // send rounds of swaps from all accounts
    for (let i = 0; i < 3; i++) {
        const swaps = await flood.generateSwaps({minUSD: 100, maxUSD: 5000}, userWallets)
        await swaps.sendToMempool()
    }
}

const withLiquid = async () => {
    const flood = new MevFlood(admin, provider)
    try {
        const deployment = await MevFlood.loadDeployment(deployFile)
        // we have to fund wallets every time bc this script creates random wallets
        await flood.withDeployment(deployment).fundWallets(userWallets.map(w => w.address), 3)
        const swaps = await flood.withDeployment(deployment).generateSwaps({maxUSD: 1000}, userWallets)
        await swaps.sendToMempool()
    } catch (e) {
        throw new Error(`failed to load deployment at '${deployFile}'`)
    }
    try {
        const deployment = await MevFlood.loadDeployment(deployFile)
        const flood = new MevFlood(admin, provider, deployment)
        await flood.fundWallets(userWallets.map(w => w.address), 3)
        const swaps = await flood.generateSwaps({maxUSD: 1000}, userWallets)
        await swaps.sendToMempool()
    } catch (e) {
        throw new Error(`failed to load deployment at '${deployFile}'`)
    }
}

const arbor = async () => {
    const userWallet = new Wallet("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6") // hh[3]
    const flood = new MevFlood(admin, provider)

    const fundRes = await flood.fundWallets([userWallet.address], 20)
    await fundRes[0].wait(1)

    const liquidRes = await flood.liquid({
        wethMintAmountAdmin: 10,
        wethMintAmountUser: 1,
    }, userWallet)

    const deployRes = await liquidRes.deployToMempool()
    await Promise.all(deployRes.map(r => r.wait(1)))
    const contracts = liquidRes.deployment.getDeployedContracts(provider)
    const daiContract = contracts.dai[0]

    // generate a swap from the user account
    const swapRes = await flood.generateSwaps({minUSD: 500, maxUSD: 500, swapOnA: true, swapWethForDai: true, daiIndex: 0}, [userWallet], 0)
    const swapResponse = await swapRes.sendToMempool()
    const confirmedSwap = (await swapResponse[0].wait(1)).status === 1
    if (confirmedSwap) {
        console.error("swap landed")
    }

    const daiBalanceStart = await daiContract?.balanceOf(admin.address)

    // backrun the swap w/ an arb
    const backrun = await flood.backrun(parseTransaction(swapRes.swaps.signedSwaps[0]))
    const backrunSendRes = await backrun.sendToMempool()
    if ((await backrunSendRes?.wait())?.status === 1) {
        console.log("backrun landed")
    }

    const daiBalanceAfter = await daiContract?.balanceOf(admin.address)
    console.log(`[before] DAI balance\t${formatEther(daiBalanceStart)}`)
    console.log(`[after] DAI balance\t${formatEther(daiBalanceAfter)}`)
    console.log(`profit: ${formatEther(daiBalanceAfter.sub(daiBalanceStart))} DAI`)
}

arbor()
