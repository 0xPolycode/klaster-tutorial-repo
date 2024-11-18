import axios from "axios";
import { batchTx, BridgePlugin, BridgePluginParams, encodeApproveTx, rawTx } from "klaster-sdk";

// Axios instance for base configuration
const synapseClient = axios.create({
  baseURL: "https://api.synapseprotocol.com",
  headers: {
    accept: "application/json",
    "content-type": "application/json",
  },
});

// Fetch bridge quote from Synapse
/**
 * Fetches the suggested route by Synapse based on bridge plugin parameters.
 * @param params - BridgePluginParams containing token and chain information.
 * @returns A promise resolving to the route data from Synapse.
 */
async function fetchBridgeQuote(params: BridgePluginParams) {
  const response = await synapseClient.get("/bridge", {
    params: {
      fromChain: params.sourceChainId,
      toChain: params.destinationChainId,
      fromToken: params.sourceToken,
      toToken: params.destinationToken,
      amount: params.amount.toString(),
      originUserAddress: params.account.getAddresses([params.sourceChainId]),
      destAddress: params.account.getAddresses([params.destinationChainId]),
    },
  });

  // Response is an array of possible routes, select the best one based on maxAmountOut
  const routes = response.data;
  if (!routes || routes.length === 0) {
    throw new Error("No bridge routes available");
  }

  // Sort by maxAmountOut and select the best route
  const bestRoute = routes.reduce((best: any, current: any) => {
    const currentAmount = BigInt(current.maxAmountOut.hex);
    const bestAmount = BigInt(best.maxAmountOut.hex);
    return currentAmount > bestAmount ? current : best;
  }, routes[0]);

  return bestRoute;
}

// Prepare and send Synapse transaction
/**
 * Prepares and sends the Synapse transaction with the source and destination addresses.
 * @param route - The route object returned from Synapse fetchBridgeQuote.
 * @returns A promise resolving to the transaction data.
 */
function prepareTransactionData(route: any) {
  return {
    data: route.callData.data,
    to: route.callData.to,
    value: BigInt(route.callData.value.hex),
    gasLimit: "250000", // Default gas limit, can be adjusted based on the chain
  };
}

// Main Synapse Bridge Plugin
export const synapseBridgePlugin: BridgePlugin = async (params: any) => {
  // Fetch Synapse bridge quote
  const routeData = await fetchBridgeQuote(params);

  // Get transaction data
  const transactionData = prepareTransactionData(routeData);

  // Calculate the output amount on the destination chain
  const receivedAmount = BigInt(routeData.maxAmountOut.hex);

  // Create approval transaction for source token
  const approvalTx = encodeApproveTx({
    tokenAddress: params.sourceToken,
    amount: params.amount,
    recipient: transactionData.to,
  });

  // Create the transaction to initiate bridging
  const callBridgeTx = rawTx({
    to: transactionData.to,
    data: transactionData.data,
    value: transactionData.value,
    gasLimit: transactionData.gasLimit,
  });

  // Return the batch of transactions
  return {
    receivedOnDestination: receivedAmount,
    transactions: batchTx(params.sourceChainId, [approvalTx, callBridgeTx]),
  };
};