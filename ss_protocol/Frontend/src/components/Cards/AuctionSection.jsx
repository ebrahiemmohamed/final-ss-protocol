import "bootstrap/dist/css/bootstrap.min.css";
import "../../Styles/InfoCards.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import "@fortawesome/fontawesome-free/css/all.min.css";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import PLSLogo from "../../assets/pls1.png";
import BNBLogo from "../../assets/bnb.png";
import matic from "../../assets/matic-token-icon.png";
import sonic from "../../assets/S_token.svg";
import { TokensDetails } from "../../data/TokensDetails";
import { useDAvContract } from "../../Functions/DavTokenFunctions";
import DotAnimation from "../../Animations/Animation";
import { useAccount, useChainId } from "wagmi";
import { faCheck, faCopy } from "@fortawesome/free-solid-svg-icons";
import toast from "react-hot-toast";
import { useSwapContract } from "../../Functions/SwapContractFunctions";
import { chainCurrencyMap } from "../../../WalletConfig";
import useTokenBalances from "../Swap/UserTokenBalances";
import { useAllTokens } from "../Swap/Tokens";
import { ContractContext } from "../../Functions/ContractInitialize";
import { notifyError } from "../../Constants/Constants";
import { calculatePlsValueNumeric, formatNumber, formatWithCommas } from "../../Constants/Utils";
import { calculateAmmValuesAsync } from "../../utils/workerManager";
// Optimized: Use Zustand stores for selective subscriptions
import { useTokenStore } from "../../stores";

const AuctionSection = () => {
    const chainId = useChainId();
    const { tokens } = TokensDetails();
    const TOKENS = useAllTokens();
    const { signer, AllContracts, contracts, provider } = useContext(ContractContext);
    const tokenBalances = useTokenBalances(TOKENS, signer);
    const { address } = useAccount();
    const {
        mintDAV,
        claimableAmount,
        isLoading,
        claimAmount,
        isClaiming,
        davHolds,
        davExpireHolds,
        ReferralAMount,
        stateHolding,
        DavMintFee,
        ReferralCodeOfUser,
        davGovernanceHolds,
        totalInvestedPls,
        // On-chain ROI (authoritative for claim eligibility)
        roiTotalValuePls,
        roiRequiredValuePls,
        roiMeets,
        roiPercentage,
        // Client-side ROI (kept for fallback only)
        roiClientPercentage,
        roiClientTotalPls,
        roiClientRequiredPls,
        roiClientMeets,
    } = useDAvContract();
    const { CalculationOfCost, TotalCost, getAirdropAmount, getInputAmount, getOutPutAmount } = useSwapContract();
    // Optimized: Use store for static price data
    const pstateToPlsRatio = useTokenStore(state => state.pstateToPlsRatio);
    const DaipriceChange = useTokenStore(state => state.DaipriceChange);
    const [amount, setAmount] = useState("");
    const [Refferalamount, setReferralAmount] = useState("");
    const [load, setLoad] = useState(false);
    const [copied, setCopied] = useState(false);
    const [copiedCode, setCopiedCode] = useState("");
    const AuthAddress = import.meta.env.VITE_AUTH_ADDRESS;
    const [isGov, setIsGov] = useState(false);
    // Worker-based AMM estimate (null = not calculated yet)
    const [ammEstimatedPls, setAmmEstimatedPls] = useState(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                if (!AllContracts?.AuctionContract || !address) return;
                const gov = (await (provider ? AllContracts.AuctionContract.connect(provider) : AllContracts.AuctionContract).governanceAddress()).toLowerCase();
                const me = address.toLowerCase();
                if (!cancelled) setIsGov(gov === me);
            } catch {
                // Fallback to env if contract read not available
                if (!cancelled) setIsGov(!!AuthAddress && address?.toLowerCase() === AuthAddress?.toLowerCase());
            }
        })();
        return () => { cancelled = true; };
    }, [AllContracts?.AuctionContract, address, AuthAddress, provider]);

    const nativeSymbol = chainCurrencyMap[chainId] || 'PLS';
    const setBackLogo = () => {
        if (chainId === 369) return PLSLogo;
        else if (chainId === 56) return BNBLogo;
        else if (chainId === 137) return matic;
        else if (chainId === 146) return sonic;
        return PLSLogo;
    };
    const getLogoSize = () => {
        return chainId === 56
            ? { width: "170px", height: "140px" }
            : chainId === 369
                ? { width: "110px", height: "110px" }
                : chainId === 137
                    ? { width: "110px", height: "110px" }
                    : { width: "110px", height: "140px" }
    };

    const handleMint = () => {
        // Pre-validations for better UX
        if (!amount || amount.trim() === "") {
            notifyError("Enter mint amount");
            return;
        }
        if (amount === "0") {
            notifyError("Amount must be greater than zero");
            return;
        }
        if (!/^[0-9]+$/.test(amount)) { // Should already be enforced, but double-safety
            notifyError("Amount must be a whole number");
            return;
        }
        if (!DavMintFee || DavMintFee === "0" || DavMintFee === "0.0") {
            notifyError("Mint price not loaded yet – please wait a moment");
            return;
        }
        if (isGov) {
            notifyError("Governance cannot mint DAV");
            return;
        }
        setLoad(true);
        setTimeout(async () => {
            try {
                const tx = await mintDAV(amount, Refferalamount);
                if (tx) {
                    await Promise.all([
                        getAirdropAmount(),
                        getInputAmount(),
                        getOutPutAmount()
                    ]);
                }
                setAmount("");
                setReferralAmount("");
            } catch (error) {
                // Error already surfaced by mintDAV; just log and reset loader
                console.error("Minting error (caught in UI):", error);
            } finally {
                setLoad(false);
            }
        }, 0);
    };

    const handleInputChange = (e) => {
        if (/^\d*$/.test(e.target.value)) {
            setAmount(e.target.value);
        }
        CalculationOfCost(e.target.value);
    };
    
    // Legacy ratio-based calculation (kept as fallback)
    const calculateTotalSum = () => {
        const tokensPls = tokens.reduce((sum, token) => {
            return sum + calculatePlsValueNumeric(token, tokenBalances, pstateToPlsRatio);
        }, 0);
        const stateBalRaw = tokenBalances?.["STATE"];
        const stateBal = Number.parseFloat(stateBalRaw || 0);
        const ratio = Number.parseFloat(pstateToPlsRatio || 0);
        const statePls = (Number.isFinite(stateBal) && Number.isFinite(ratio) && ratio > 0) ? (stateBal * ratio) : 0;
        return tokensPls + statePls;
    };

    // AMM-based calculation using the Web Worker (keeps UI thread light)
    // Per your request: add claimable rewards into this DAV page calculation only.
    useEffect(() => {
        let cancelled = false;

        const parseNumber = (v) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : 0;
        };

        const parseCommaNumber = (s) => {
            if (s === null || s === undefined) return 0;
            const cleaned = String(s).replace(/,/g, "");
            return parseNumber(cleaned);
        };

        const run = async () => {
            if (chainId !== 369) return;
            if (!tokens?.length || !tokenBalances) return;

            try {
                // Ensure STATE balance is present for worker (use on-chain stateHolding as source of truth)
                const effectiveBalances = { ...(tokenBalances || {}) };
                const stateHoldNum = parseNumber(stateHolding);
                if (stateHoldNum > 0) {
                    effectiveBalances["STATE"] = String(stateHolding);
                }

                // IMPORTANT: Worker has fallback hardcoded addresses; override them with app-configured ones.
                const stateAddressRaw = TOKENS?.["STATE"]?.address;
                let wrappedNativeKey = "Wrapped Pulse";
                if (chainId === 146) wrappedNativeKey = "Wrapped Sonic";
                else if (chainId === 137) wrappedNativeKey = "Wrapped Matic";
                else if (chainId === 1) wrappedNativeKey = "Wrapped Ether";

                let wplsAddressRaw = TOKENS?.[wrappedNativeKey]?.address;
                if (!wplsAddressRaw) {
                    const wplsEntry = Object.values(TOKENS || {}).find(t => t?.symbol === 'WPLS');
                    wplsAddressRaw = wplsEntry?.address;
                }

                // Reduce worker load: only send tokens with a non-zero balance (plus DAV/STATE)
                const filteredTokens = tokens.filter(t => {
                    const name = t?.tokenName;
                    if (!name) return false;
                    if (name === 'DAV' || name === 'STATE') return true;
                    return parseNumber(effectiveBalances?.[name]) > 0;
                });

                const { totalSum } = await calculateAmmValuesAsync(
                    filteredTokens,
                    effectiveBalances,
                    {
                        onlyTotal: true,
                        stateAddress: stateAddressRaw,
                        wplsAddress: wplsAddressRaw,
                    }
                );
                const portfolioPls = parseCommaNumber(totalSum);
                const claimablePls = parseNumber(claimableAmount);
                const total = portfolioPls + claimablePls;

                if (!cancelled) setAmmEstimatedPls(total);
            } catch (error) {
                console.error('Worker AMM total error:', error);
                // Fallback to ratio-based calculation (+ claimable)
                if (!cancelled) {
                    const fallback = calculateTotalSum();
                    const claimablePls = parseNumber(claimableAmount);
                    setAmmEstimatedPls(fallback + claimablePls);
                }
            }
        };

        run();
        return () => { cancelled = true; };
    }, [chainId, tokens, tokenBalances, claimableAmount, stateHolding]);

    const handleOptionalInputChange = (e) => {
        setReferralAmount(e.target.value);
    };

    useEffect(() => {
        CalculationOfCost(amount);
    }, [CalculationOfCost, amount]);

    // Use AMM-calculated value instead of on-chain ratio-based value
    const estimatedPlsValue = useMemo(() => {
        // Use worker AMM calculation when available (0 is a valid value)
        if (ammEstimatedPls !== null) return ammEstimatedPls;
        // Fallback to on-chain value if AMM not ready
        const v = Number.parseFloat(roiTotalValuePls || 0);
        if (Number.isFinite(v) && v >= 0) return v;
        // Last resort: ratio-based client calculation
        try {
            const fallback = calculateTotalSum();
            return Number.isFinite(fallback) ? Math.max(0, fallback) : 0;
        } catch { return 0; }
    }, [ammEstimatedPls, roiTotalValuePls]);

    const requiredPlsValue = useMemo(() => {
        const v = Number.parseFloat(roiRequiredValuePls || 0);
        if (Number.isFinite(v) && v >= 0) return v;
        // Fallback to previous logic if on-chain missing
        const r1 = Number.parseFloat(roiClientRequiredPls || 0);
        const r2 = Number.parseFloat(totalInvestedPls || 0);
        const r = Number.isFinite(r1) && r1 > 0 ? r1 : (Number.isFinite(r2) ? r2 : 0);
        return Math.max(0, r);
    }, [roiRequiredValuePls, roiClientRequiredPls, totalInvestedPls]);

    const roiPctDisplay = useMemo(() => {
        // Use AMM-based calculation instead of on-chain roiPercentage
        if (!requiredPlsValue || requiredPlsValue <= 0) return '0';
        const pct = Math.trunc((estimatedPlsValue * 100) / requiredPlsValue);
        return String(pct >= 0 ? pct : 0);
    }, [estimatedPlsValue, requiredPlsValue]);
    return (
        <div className="container mt-4">
            <div className="row g-4 d-flex align-items-stretch pb-1">
                <div className="col-md-4 p-0 m-2 cards">
                    <div className="card bg-dark text-light border-light p-3 text-center w-100" style={{ minHeight: "260px" }}>
                        {/* Auction timer moved to Auction header */}
                        <div className="mb-2 d-flex justify-content-center align-items-center gap-2">
                            <div className="floating-input-container" style={{ maxWidth: "300px" }}>
                                <input
                                    type="text"
                                    id="affiliateLink"
                                    list="referralSuggestions"
                                    className={`form-control text-center fw-bold ${Refferalamount ? "filled" : ""}`}
                                    value={Refferalamount}
                                    onChange={handleOptionalInputChange}
                                    style={{ height: "38px", color: "#ffffff" }}
                                />
                                <label htmlFor="affiliateLink" className="floating-label">
                                    Affiliate Link - Optional
                                </label>
                                <datalist id="referralSuggestions">
                                    {copiedCode && <option value={copiedCode} />}
                                </datalist>
                            </div>
                        </div>
                        <div className="mt-2 mb-2 d-flex justify-content-center align-items-center">
                            <div className="floating-input-container" style={{ maxWidth: "300px" }}>
                                <input
                                    type="text"
                                    id="mintAmount"
                                    className={`form-control text-center fw-bold ${amount ? "filled" : ""}`}
                                    value={amount}
                                    onChange={handleInputChange}
                                    required
                                    style={{ height: "38px", color: "#ffffff" }}
                                />
                                <label htmlFor="mintAmount" className="floating-label">
                                    Mint DAV Token - Enter Amount
                                </label>
                            </div>
                        </div>
                        <h5 className="detailAmount">1 DAV TOKEN = {formatWithCommas(DavMintFee)} {nativeSymbol}</h5>
                        {/* Dynamically show total PLS = amount * DavMintFee for instant feedback */}
                        <h5 className="detailAmount mb-4">
                            {(() => {
                                const qty = Number(amount || 0);
                                const fee = parseFloat(DavMintFee || "0");
                                if (!qty || !fee) return "0";
                                const total = qty * fee;
                                // Use more decimals for very small fees to avoid showing 0
                                const decimals = fee < 1 ? 4 : 2;
                                return `${formatWithCommas(total.toFixed(decimals))}`;
                            })()} {nativeSymbol}
                        </h5>

                        <div className="d-flex justify-content-center">
                            <button
                                onClick={() => {
                                    if (isGov) {
                                        notifyError("Governance cannot mint DAV");
                                        return;
                                    }
                                    handleMint();
                                }}
                                className="btn btn-primary btn-sm mb-0"
                                style={{ width: "200px" }}
                                disabled={load || isGov}
                                title={isGov ? "Governance cannot mint DAV" : "Mint DAV"}
                            >
                                {load ? "Minting..." : "Mint"}
                            </button>
                        </div>
                    </div>
                </div>
                <div className="col-md-4 p-0 m-2 cards">
                    <div className="card bg-dark text-light border-light p-3 d-flex w-100">
                        <img
                            src={setBackLogo()}
                            alt="native currency Logo"
                            style={{
                                position: "absolute",
                                ...getLogoSize(),
                                opacity: 0.1,
                                top: "25%",
                                left: "80%",
                                transform: "translate(-50%, -50%)",
                                zIndex: 0,
                                pointerEvents: "none",
                            }}
                        />
                        <div>
                            <div className="carddetaildiv uppercase d-flex justify-content-between align-items-center">
                                <div className="carddetails2">
                                    <div className="d-flex align-items-center gap-2">
                                        <p className="mb-1 detailText">ACTIVE DAV / EXPIRED DAV</p>
                                        {isGov && (
                                            <span className="badge bg-info text-dark" title="You are connected with governance">
                                                GOV
                                            </span>
                                        )}
                                    </div>
                                    <div className="d-flex">
                                        <h5>
                                            {isGov ? (
                                                <>{(isLoading && davGovernanceHolds === "0.0") ? <DotAnimation /> : davGovernanceHolds}</>
                                            ) : (
                                                <>{(isLoading && davHolds === "0.0") ? <DotAnimation /> : davHolds}</>
                                            )}{" "}
                                            / {(isLoading && davExpireHolds === "0.0") ? (
                                                <DotAnimation />
                                            ) : (
                                                // Governance DAV never expires: display 0 expired for governance wallet
                                                isGov ? 0 : davExpireHolds
                                            )}
                                        </h5>
                                    </div>
                                </div>
                            </div>
                            <div className="carddetails2 mt-1">
                                <h6 className="detailText d-flex" style={{ fontSize: "14px", textTransform: "capitalize" }}>
                                    {chainId == 146 ? "SONIC - HOLDERS FEE" : "HOLDERS FEE"}
                                </h6>
                                <h5>{formatWithCommas(claimableAmount)} {nativeSymbol}</h5>
                                <div className="d-flex justify-content-center">
                                    <button
                                        onClick={async () => {
                                            setTimeout(async () => {
                                                try {
                                                    await claimAmount();
                                                } catch (error) {
                                                    console.error("Error claiming:", error);
                                                    alert("Claiming failed! Please try again.");
                                                }
                                            }, 100);
                                        }}
                                        className="btn btn-primary d-flex btn-sm justify-content-center align-items-center mx-5 mt-4"
                                        style={{ width: "190px" }}
                                        disabled={Number(claimableAmount) === 0 || isClaiming}
                                    >
                                        {isClaiming ? "Claiming..." : "Claim"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="col-md-4 p-0 m-2 cards">
                    <div className="card bg-dark text-light border-light p-3 d-flex w-100">
                        <div>
                            <div className="carddetaildiv uppercase d-flex justify-content-between align-items-center">
                                <div className="carddetails2">
                                    <p className="mb-1">
                                        <span className="detailText">
                                            State Token Holding -{" "}
                                        </span>
                                        <span className="second-span-fontsize">{formatWithCommas(stateHolding)}</span>
                                    </p>
                                    <p className="mb-1">
                                        <span className="detailText">Affiliate com received - </span>
                                        <span className="second-span-fontsize">{formatWithCommas(ReferralAMount)} {nativeSymbol}</span>
                                    </p>
                                    <p className="mb-1 ">
                                        <span className="detailText">Your Affiliate Link - </span>
                                        <span className="second-span-fontsize" style={{ textTransform: "none" }}>{ReferralCodeOfUser}</span>
                                        <button
                                            onClick={() => {
                                                navigator.clipboard.writeText(ReferralCodeOfUser);
                                                setCopied(true);
                                                setCopiedCode(ReferralCodeOfUser);
                                                setTimeout(() => setCopied(false), 2000);
                                            }}
                                            className="btn btn-outline-light btn-sm py-0 px-2 mx-2"
                                            style={{ fontSize: "14px" }}
                                            title={copied ? "Copied!" : "Copy"}
                                        >
                                            <FontAwesomeIcon icon={copied ? faCheck : faCopy} />
                                        </button>
                                    </p>
                                    <p className="mb-1">
                                        <span className="detailText">ROI / {nativeSymbol} -</span>
                                        <span className="ms-1 second-span-fontsize">
                                            {(isLoading && requiredPlsValue === 0 && estimatedPlsValue === 0) ? (
                                                <DotAnimation />
                                            ) : (
                                                <>
                                                    {formatWithCommas(String(requiredPlsValue || 0))} / {""}
                                                    <span style={{ color: (roiMeets === 'true' || roiMeets === true || (estimatedPlsValue >= requiredPlsValue && requiredPlsValue > 0)) ? '#28a745' : '#ff4081' }}>
                                                        {formatWithCommas(String(Number.isFinite(estimatedPlsValue) ? Math.trunc(estimatedPlsValue) : 0))} {nativeSymbol}
                                                    </span>
                                                </>
                                            )}
                                        </span>
                                    </p>
                                    <p className="mb-1">
                                        <span className="detailText">USER ROI % -</span>
                                        <span className="ms-1 second-span-fontsize" style={{ color: roiPctDisplay >= 100 ? '#28a745' : '#ff4081' }}>
                                            {(isLoading && roiPctDisplay === '0') ? <DotAnimation /> : formatWithCommas(roiPctDisplay)} %
                                        </span>
                                    </p>

                                    {/* USER APR removed as requested */}
                                    {/* PLS INDEX hidden from UI (integration kept) */}
                                    {/* <p className="mb-1">
                                        <span className="detailText">{nativeSymbol} INDEX -</span>
                                        <span className="ms-1 second-span-fontsize">
                                            {isLoading ? (
                                                <DotAnimation />
                                            ) : (
                                                <>
                                                    <span
                                                        style={{
                                                            color: DaipriceChange > 0 ? '#28a745' : DaipriceChange < 0 ? '#ff4081' : '#ffffff'
                                                        }}  >
                                                        ({DaipriceChange} %)
                                                    </span>{" "}
                                                    {formatWithCommas(
                                                        parseFloat(Math.max(calculateTotalSum() * DaipriceChange, 0) / 100).toFixed(2)
                                                    )}{" "}
                                                    {nativeSymbol}
                                                </>
                                            )}
                                        </span>
                                    </p> */}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div >
    );
};

export default AuctionSection;