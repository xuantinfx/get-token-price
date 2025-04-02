require("dotenv").config();
const { ethers } = require("ethers");
const https = require('https');

// Cấu hình
const BSC_RPC_URL = "https://bsc-dataseed.binance.org/"; // RPC chính thức của BSC
const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);

// Auto-format addresses to correct checksums
function formatAddress(address) {
  return ethers.getAddress(address);
}

// Addresses with auto-formatting
// PancakeSwap V2
const PANCAKE_ROUTER_V2 = formatAddress("0x10ED43C718714eb63d5aA57B78B54704E256024E");

// PancakeSwap V3
const PANCAKE_QUOTER_V3 = formatAddress("0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997");

// Tokens
const WBNB = formatAddress("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c");
const USDT = formatAddress("0x55d398326f99059fF775485246999027B3197955"); // BSC USDT (USDT-BSC)
const BUSD = formatAddress("0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56"); // BUSD-BSC
const USDC = formatAddress("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"); // USDC-BSC

// ABIs
const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) external view returns (uint[] memory amounts)"
];

const QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
];

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)"
];

const routerContract = new ethers.Contract(PANCAKE_ROUTER_V2, ROUTER_ABI, provider);
const quoterContract = new ethers.Contract(PANCAKE_QUOTER_V3, QUOTER_ABI, provider);

/**
 * Gọi API để lấy dữ liệu
 * @param {string} url - URL của API
 * @returns {Promise<Object>} - Dữ liệu JSON từ API
 */
function fetchAPI(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      }
    }, (res) => {
      let data = '';
      
      // Kiểm tra status code
      if (res.statusCode !== 200) {
        reject(new Error(`API returned status code ${res.statusCode}`));
        return;
      }
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve(jsonData);
        } catch (e) {
          reject(new Error(`Error parsing JSON: ${e.message}. Data: ${data.substring(0, 100)}...`));
        }
      });
      
    }).on('error', (err) => {
      reject(err);
    });
    
    // Set timeout cho request
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Lấy giá token từ Binance API
 * @param {string} tokenAddress - Địa chỉ token cần lấy giá
 * @param {string} symbol - Symbol của token
 * @param {string} mode - "bnb" hoặc "usdt"
 * @returns {Promise<string|null>} - Giá token hoặc null nếu không tìm thấy
 */
async function getPriceDexScreener(tokenAddress, symbol, mode) {
  try {
    const formattedTokenAddress = formatAddress(tokenAddress);
    
    // Sử dụng DexScreener API để lấy thông tin token
    const url = `https://api.dexscreener.com/latest/dex/tokens/${formattedTokenAddress}`;
    
    const data = await fetchAPI(url);
    
    if (data && data.pairs && data.pairs.length > 0) {
      // Sắp xếp theo liquidity giảm dần
      const sortedPairs = data.pairs.sort((a, b) => 
        parseFloat(b.liquidity?.usd || 0) - parseFloat(a.liquidity?.usd || 0)
      );
      
      // Lấy cặp có thanh khoản cao nhất
      const bestPair = sortedPairs[0];
      
      if (mode.toLowerCase() === "bnb") {
        if (bestPair.priceNative) {
          console.log(`Giá của token ${symbol} theo BNB (DexScreener): ${bestPair.priceNative} BNB`);
          console.log(`Sàn: ${bestPair.dexId}, Liquidity: $${bestPair.liquidity?.usd || 'N/A'}`);
          return bestPair.priceNative;
        }
      } else if (mode.toLowerCase() === "usdt") {
        if (bestPair.priceUsd) {
          console.log(`Giá của token ${symbol} theo USD (DexScreener): ${bestPair.priceUsd} USD`);
          console.log(`Sàn: ${bestPair.dexId}, Liquidity: $${bestPair.liquidity?.usd || 'N/A'}`);
          return bestPair.priceUsd;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error("Lỗi khi lấy giá từ DexScreener:", error.message);
    return null;
  }
}

/**
 * Lấy thông tin symbol, name và decimals của token
 * @param {string} tokenAddress - Địa chỉ contract của token
 * @returns {Promise<{symbol: string, name: string, decimals: number}>} - Symbol, name và số decimal của token
 */
async function getTokenInfo(tokenAddress) {
  try {
    const formattedAddress = formatAddress(tokenAddress);
    const tokenContract = new ethers.Contract(formattedAddress, ERC20_ABI, provider);
    
    const [symbol, name, decimals] = await Promise.all([
      tokenContract.symbol(),
      tokenContract.name(),
      tokenContract.decimals()
    ]);
    
    console.log(`Token ${formattedAddress}:`);
    console.log(`- Symbol: ${symbol}`);
    console.log(`- Name: ${name}`);
    console.log(`- Decimals: ${decimals}`);
    
    return { symbol, name, decimals };
  } catch (error) {
    console.error(`Lỗi khi lấy thông tin token ${tokenAddress}:`, error.message);
    return { symbol: "UNKNOWN", name: "Unknown Token", decimals: 18 };
  }
}

/**
 * Kiểm tra xem path có tồn tại thanh khoản không trên PancakeSwap V2
 * @param {array} path - Mảng các địa chỉ token trong path
 * @param {number} decimals - Số decimal của token cần check giá
 * @returns {Promise<boolean>} - true nếu path có thanh khoản, false nếu không
 */
async function checkPathLiquidityV2(path, decimals) {
  try {
    const amountIn = ethers.parseUnits("1", decimals);
    await routerContract.getAmountsOut(amountIn, path);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Thử lấy giá token trên PancakeSwap V3
 * @param {string} tokenIn - Địa chỉ token input
 * @param {string} tokenOut - Địa chỉ token output
 * @param {number} decimalsIn - Số decimal của token input
 * @returns {Promise<string|null>} - Giá token hoặc null nếu không thành công
 */
async function tryGetPriceV3(tokenIn, tokenOut, decimalsIn) {
  // Các fee tiers của PancakeSwap V3 (0.01%, 0.05%, 0.25%, 1%)
  const feeTiers = [100, 500, 2500, 10000];
  
  for (const fee of feeTiers) {
    try {
      const amountIn = ethers.parseUnits("1", decimalsIn);
      const sqrtPriceLimitX96 = 0;
      
      const amountOut = await quoterContract.quoteExactInputSingle(
        tokenIn,
        tokenOut,
        fee,
        amountIn,
        sqrtPriceLimitX96
      );
      
      return ethers.formatUnits(amountOut, 18);
    } catch (error) {
      console.error("Lỗi khi lấy giá từ PancakeSwap V3:", error.message);
      // Thử fee tier tiếp theo
      continue;
    }
  }
  
  return null;
}

/**
 * Lấy giá token trên PancakeSwap V2 hoặc V3 hoặc các API khác theo BNB hoặc USDT
 * @param {string} tokenAddress - Địa chỉ contract của token
 * @param {string} mode - Chế độ lấy giá: "bnb" hoặc "usdt"
 * @param {boolean} tryV3 - Thử dùng V3 nếu V2 không có
 * @returns {Promise<{price: string|null, version: string|null, path: string[]|null}>} - Giá, phiên bản và path
 */
async function getTokenPrice(tokenAddress, mode = "bnb", tryV3 = true) {
  try {
    // Ensure proper checksum for token address
    const formattedTokenAddress = formatAddress(tokenAddress);
    
    // Nếu token là WBNB, USDT hoặc BUSD thì xử lý đặc biệt
    if (formattedTokenAddress === WBNB) {
      if (mode.toLowerCase() === "usdt") {
        // Lấy giá BNB/USDT
        const amountIn = ethers.parseUnits("1", 18);
        const path = [WBNB, USDT];
        const amounts = await routerContract.getAmountsOut(amountIn, path);
        const price = ethers.formatUnits(amounts[1], 18);
        console.log(`Giá của BNB theo USDT: ${price} USDT`);
        return { price, version: "v2", path: ["WBNB", "USDT"] };
      } else {
        // Giá của WBNB theo chính nó là 1
        console.log("Giá của BNB theo BNB: 1 BNB");
        return { price: "1", version: "n/a", path: ["WBNB"] };
      }
    } else if (formattedTokenAddress === USDT && mode.toLowerCase() === "bnb") {
      // Lấy giá USDT/BNB
      const amountIn = ethers.parseUnits("1", 18);
      const path = [USDT, WBNB];
      const amounts = await routerContract.getAmountsOut(amountIn, path);
      const price = ethers.formatUnits(amounts[1], 18);
      console.log(`Giá của USDT theo BNB: ${price} BNB`);
      return { price, version: "v2", path: ["USDT", "WBNB"] };
    }
    
    // Lấy thông tin token để biết số decimals
    const { symbol, decimals } = await getTokenInfo(formattedTokenAddress);
    
    // ======= Thử PancakeSwap V2 ========
    let priceQuote;
    let quoteToken;
    
    if (mode.toLowerCase() === "usdt") {
      priceQuote = "USDT";
      quoteToken = USDT;
    } else {
      priceQuote = "BNB";
      quoteToken = WBNB;
    }
    
    // Thử các path khác nhau trong V2
    const pathsV2 = [
      [formattedTokenAddress, quoteToken],
      [formattedTokenAddress, WBNB, quoteToken],
      [formattedTokenAddress, BUSD, quoteToken],
      [formattedTokenAddress, USDC, quoteToken]
    ];
    
    // Nếu đang tìm giá theo USDT, loại bỏ path có WBNB ở giữa
    if (mode.toLowerCase() === "usdt") {
      // Filter pathsV2
    }
    
    // Kiểm tra từng path xem có thanh khoản không
    let validPath = null;
    
    for (const path of pathsV2) {
      const hasLiquidity = await checkPathLiquidityV2(path, decimals);
      if (hasLiquidity) {
        validPath = path;
        
        // Lấy giá từ path có thanh khoản
        const amountIn = ethers.parseUnits("1", decimals);
        const amounts = await routerContract.getAmountsOut(amountIn, path);
        const quoteIndex = path.length - 1;
        const price = ethers.formatUnits(amounts[quoteIndex], 18);
        
        // Log thông tin path đã dùng
        const pathSymbols = await Promise.all(path.map(async (addr) => {
          if (addr === WBNB) return "WBNB";
          if (addr === USDT) return "USDT";
          if (addr === BUSD) return "BUSD";
          if (addr === USDC) return "USDC";
          if (addr === formattedTokenAddress) return symbol;
          
          try {
            const tokenInfo = await getTokenInfo(addr);
            return tokenInfo.symbol;
          } catch (e) {
            return addr.substring(0, 6) + "...";
          }
        }));
        
        console.log(`Path đã dùng (V2): ${pathSymbols.join(" → ")}`);
        console.log(`Giá của token ${symbol} (${formattedTokenAddress}) theo ${priceQuote}: ${price} ${priceQuote}`);
        
        return { price, version: "v2", path: pathSymbols };
      }
    }
    
    // ======= Nếu V2 không có thanh khoản và tryV3 = true, thử PancakeSwap V3 ========
    if (tryV3) {
      console.log(`Không tìm thấy thanh khoản trên PancakeSwap V2, thử dùng V3...`);
      
      try {
        let priceV3 = null;
        
        if (mode.toLowerCase() === "usdt") {
          // Thử lấy giá trực tiếp với USDT
          priceV3 = await tryGetPriceV3(formattedTokenAddress, USDT, decimals);
          
          // Nếu không có cặp trực tiếp, thử qua WBNB
          if (!priceV3) {
            const priceInBNB = await tryGetPriceV3(formattedTokenAddress, WBNB, decimals);
            if (priceInBNB) {
              const bnbPriceInUSDT = await tryGetPriceV3(WBNB, USDT, 18);
              if (bnbPriceInUSDT) {
                priceV3 = (parseFloat(priceInBNB) * parseFloat(bnbPriceInUSDT)).toString();
                console.log(`Path đã dùng (V3): ${symbol} → WBNB → USDT`);
              }
            }
          } else {
            console.log(`Path đã dùng (V3): ${symbol} → USDT`);
          }
        } else {
          // Lấy giá theo BNB
          priceV3 = await tryGetPriceV3(formattedTokenAddress, WBNB, decimals);
          if (priceV3) {
            console.log(`Path đã dùng (V3): ${symbol} → WBNB`);
          }
        }
        
        if (priceV3) {
          console.log(`Giá của token ${symbol} (${formattedTokenAddress}) theo ${priceQuote} (V3): ${priceV3} ${priceQuote}`);
          return { 
            price: priceV3, 
            version: "v3", 
            path: mode.toLowerCase() === "usdt" ? [symbol, "USDT"] : [symbol, "WBNB"] 
          };
        }
      } catch (error) {
        console.error("Lỗi khi lấy giá từ PancakeSwap V3:", error.message);
      }
    }
    
    // ======= Nếu không có trên PancakeSwap, thử dùng DexScreener API ========
    console.log(`Không tìm thấy thanh khoản trên PancakeSwap, thử dùng DexScreener API...`);
    const priceDexScreener = await getPriceDexScreener(formattedTokenAddress, symbol, mode);
    
    if (priceDexScreener) {
      return {
        price: priceDexScreener,
        version: "dexscreener",
        path: [symbol, mode.toLowerCase() === "usdt" ? "USDT" : "WBNB"]
      };
    }
    
    // Không tìm thấy thanh khoản
    console.log(`Không tìm thấy thanh khoản cho token ${symbol} (${formattedTokenAddress}) trên bất kỳ sàn nào`);
    return { price: null, version: null, path: null };
    
  } catch (error) {
    console.error("Lỗi khi lấy giá token:", error.message);
    return { price: null, version: null, path: null };
  }
}

// Thử nghiệm với các tokens
const CAKE = "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82";
const UGO = "0x66a2ed2F04BC7D2a03785DD04261A2FA595a5839";

// Thực hiện kiểm tra giá theo cả hai chế độ
async function checkPrices(tokenAddress) {
  console.log("=== THÔNG TIN TOKEN ===");
  const { symbol } = await getTokenInfo(tokenAddress);
  
  console.log(`\n=== GIÁ TOKEN ${symbol} ===`);
  console.log("Kiểm tra giá theo BNB:");
  const bnbResult = await getTokenPrice(tokenAddress, "bnb", true);
  
  console.log("\nKiểm tra giá theo USDT:");
  const usdtResult = await getTokenPrice(tokenAddress, "usdt", true);
  
  return { 
    symbol, 
    bnb: { price: bnbResult.price, version: bnbResult.version },
    usdt: { price: usdtResult.price, version: usdtResult.version } 
  };
}

// Chạy kiểm tra với các tokens
async function runTests() {
  console.log("\n\n=== KIỂM TRA TOKEN CÓ THANH KHOẢN (CAKE) ===");
  await checkPrices(CAKE);
  
  console.log("\n\n=== KIỂM TRA TOKEN UGO ===");
  await checkPrices(UGO);
}

runTests();
