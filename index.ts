import { Wallet, providers } from "ethers"
import MevFlood from "mev-flood"

async function main() {
    const admin = new Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
    const provider = new providers.JsonRpcProvider("http://localhost:8545")
    const flood = new MevFlood(admin, provider)
    const userWallets = [...Array(10)].map(i => Wallet.createRandom())
    const fundWalletsRes = await flood.fundWallets(
        userWallets.map(wallet => wallet.address),
        13
    )
    console.log((await fundWalletsRes[0].wait()).status === 1 ? 
        "funded wallets" :
        "failed to fund wallets"
    )

    // deploy liquidity
    const {deployments} = await flood.liquid({
        shouldTestSwap: false,
        wethMintAmountAdmin: 100,
        wethMintAmountUser: 5,
    }, userWallets[0])
    if (deployments) {
        console.log("weth", deployments?.weth.contractAddress)
    
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
            }, wallet, deployments)
        }
    
        // send rounds of swaps from all accounts
        for (let i = 0; i < 3; i++) {
            await flood.sendSwaps({minUSD: 100, maxUSD: 5000}, userWallets, deployments)
        }
    } else {
        console.error("failed to initialize deployments")
    }
}

main()
