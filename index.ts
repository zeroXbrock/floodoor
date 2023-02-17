import { Wallet, providers, utils } from "ethers"
import { formatEther } from 'ethers/lib/utils'
import MevFlood from "mev-flood"
import Prompt from "prompt-sync"
const prompt = Prompt()

const admin = new Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
const provider = new providers.JsonRpcProvider("http://localhost:8545", 5)
const userWallets = [...Array(10)].map(i => Wallet.createRandom())
const deployfile = "./deployment.json"

async function standard() {

    let flood: MevFlood
    try {
        // load existing deployment
        flood = await new MevFlood(admin, provider).init(deployfile)
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
            shouldTestSwap: false,
            wethMintAmountAdmin: 50,
            wethMintAmountUser: 5,
        }, userWallets[0])

        // write deployment to file
        await flood.saveDeployment(deployfile)
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
            shouldTestSwap: false,
            wethMintAmountAdmin: 0,
            wethMintAmountUser: 5,
        }, wallet)
    }

    // send rounds of swaps from all accounts
    for (let i = 0; i < 3; i++) {
        await flood.sendSwaps({minUSD: 100, maxUSD: 5000}, userWallets)
    }
}

const chaining = async () => {
    // Async doesn't chain well
    const flood1 = await (await new MevFlood(admin, provider)
        .liquid({
        wethMintAmountAdmin: 50,
        wethMintAmountUser: 5,
        }))
        .fundWallets(userWallets.map(w => w.address), 1)

    const flood2 = await new MevFlood(admin, provider)
    .liquid({
        wethMintAmountAdmin: 50,
        wethMintAmountUser: 5,
    }).then(flood => {
        return flood.fundWallets(userWallets.map(w => w.address), 1)
    })

    const signedSwaps1 = (await flood1.sendSwaps({maxUSD: 5000, minUSD: 100}, userWallets)).signedSwaps
    const signedSwaps2 = (await flood2.sendSwaps({maxUSD: 5000, minUSD: 100}, userWallets)).signedSwaps
    await flood1.backrun(utils.parseTransaction(signedSwaps1[signedSwaps1.length - 1]))
    await flood2.backrun(utils.parseTransaction(signedSwaps2[signedSwaps1.length - 1]))
}

const withDeployment = async () => {
    const flood = new MevFlood(admin, provider)
    try {
        const deployment = await MevFlood.loadDeployment("deployment.json")
        // we have to fund wallets every time bc this script creates random wallets
        await flood.withDeployment(deployment).fundWallets(userWallets.map(w => w.address), 3)
        await flood.withDeployment(deployment).sendSwaps({maxUSD: 1000}, userWallets)
    } catch (e) {
        throw new Error(`failed to load deployment at '${deployfile}'`)
    }
    try {
        const deployment = await MevFlood.loadDeployment("deployment.json")
        const flood = new MevFlood(admin, provider, deployment)
        await flood.fundWallets(userWallets.map(w => w.address), 3)
        await flood.sendSwaps({maxUSD: 1000}, userWallets)
    } catch (e) {
        throw new Error(`failed to load deployment at '${deployfile}'`)
    }
}

const arbor = async () => {
    const flood = new MevFlood(admin, provider)
    const userWallet = Wallet.createRandom()
    const daiIndex = 0
    await flood.fundWallets([userWallet.address], 50)
    await flood.liquid({wethMintAmountAdmin: 50, wethMintAmountUser: 10, shouldTestSwap: false}, userWallet)
    const swapRes = await flood.sendSwaps({maxUSD: 10000, minUSD: 9001, swapWethForDai: true, daiIndex}, [userWallet])
    const daiContract = flood.deployment?.getDeployedContracts(provider).dai[daiIndex]
    const daiBalance = await daiContract?.balanceOf(admin.address)
    console.log(`[before] DAI balance\t${formatEther(daiBalance)}`)
    await flood.backrun(utils.parseTransaction(swapRes.signedSwaps[0]))
    const newDaiBalance = await daiContract?.balanceOf(admin.address)
    console.log(`[after] DAI balance\t${formatEther(daiBalance)}`)
    console.log(`profit: ${formatEther(newDaiBalance.sub(daiBalance))} DAI`)
}

const program = process.argv[2]
if (program == "1") {
    standard()
} else if (program == "2") {
    chaining()
} else if (program == "3") {
    withDeployment()
} else if (program == "4") {
    console.log("im arbiiiiiing")
    arbor()
}
else {
    console.warn("invalid entry, defaulting to 1 (main)")
    prompt("press enter to proceed")
    standard()
}
