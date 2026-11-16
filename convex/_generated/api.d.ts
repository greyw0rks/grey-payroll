/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as academy from "../academy.js";
import type * as academyHttp from "../academyHttp.js";
import type * as academySchema from "../academySchema.js";
import type * as academyWalletModel from "../academyWalletModel.js";
import type * as academyWalletSchema from "../academyWalletSchema.js";
import type * as academyWallets from "../academyWallets.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as lib from "../lib.js";
import type * as model from "../model.js";
import type * as nodeOps from "../nodeOps.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  academy: typeof academy;
  academyHttp: typeof academyHttp;
  academySchema: typeof academySchema;
  academyWalletModel: typeof academyWalletModel;
  academyWalletSchema: typeof academyWalletSchema;
  academyWallets: typeof academyWallets;
  crons: typeof crons;
  http: typeof http;
  lib: typeof lib;
  model: typeof model;
  nodeOps: typeof nodeOps;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
