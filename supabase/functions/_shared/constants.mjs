export const CHAIN_ID = 4663;
export const DEPLOYMENT_BLOCK = 51943083;
export const FACTORY = '0xC34c45a032c72c211B9d7Ef9ce2E05a98Caa924a';
export const EVENT_IMPLEMENTATION = '0x60FEdb4c5d1ced9C102626A5bE71eA4F1AC7Aec1';
export const FEE_VAULT = '0x8b49953059CDFf91b1B2702B46D43a8a30fE58e8';
export const ORDER_BOOK = '0x49E283E74eF0D454D90e50069a6b0FD80501fb39';
export const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
export const RESOLVER_SAFE = '0x3203441F25934CA12E8b8Adf2be8F8e0AE389112';
export const TREASURY = '0xDC2089B6fFF960007814F6e0D6D67E105a64624B';

export const FACTORY_ABI = [
  'event MarketCreated(address indexed market,address indexed creator,uint256 indexed index,bytes32 metadataHash)'
];
export const ORDER_BOOK_ABI = [
  'event OrderPlaced(uint256 indexed id,address indexed market,address indexed owner,bool yes,bool buy,uint8 price,uint256 shares,uint64 expiresAt)',
  'event OrderCancelled(uint256 indexed id,address indexed owner,uint256 refundedShares)',
  'event OrdersMatched(uint256 indexed firstId,uint256 indexed secondId,address indexed market,uint256 shares,uint8 yesPrice,uint256 notional,bool mint,uint256 timestamp)'
];
export const FEE_VAULT_ABI = [
  'event FeesAccrued(address indexed market,address indexed creator,uint256 protocolFee,uint256 creatorFee)',
  'event FeesClaimed(address indexed creator,uint256 amount)'
];
export const MARKET_ABI = [
  'event MetadataCommitted(bytes32 indexed metadataHash,bytes32 indexed questionHash,bytes32 indexed resolutionRulesHash,bytes32 yesOutcomeHash,bytes32 noOutcomeHash,bytes32 primarySourceHash,bytes32 secondarySourceHash,bytes32 resolutionTimestampHash)',
  'event Resolved(uint8 indexed outcome)',
  'event Redeemed(address indexed account,bool indexed yes,uint256 shares,uint256 payout)',
  'function metadata() view returns(tuple(string question,string yesOutcome,string noOutcome,string category,string rules,string primarySource,string secondarySource,string metadataURI))',
  'function creator() view returns(address)',
  'function closesAt() view returns(uint64)',
  'function resolvesAt() view returns(uint64)',
  'function collateralVault() view returns(address)',
  'function metadataHash() view returns(bytes32)',
  'function resolvedOutcome() view returns(uint8)',
  'function marketState() view returns(uint8)',
  'function volume() view returns(uint256)',
  'function lastYesPrice() view returns(uint8)',
  'function sharesOf(address,bool) view returns(uint256)'
];
export const COLLATERAL_ABI = ['function locked() view returns(uint256)'];
export const ORDER_STATE_ABI = [
  'function orders(uint256) view returns(address market,address owner,uint64 expiresAt,uint8 price,bool yes,bool buy,uint256 remaining)'
];
