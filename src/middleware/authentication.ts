import { MiddlewareFn } from "type-graphql";

import { IContext } from "gql/context";
import { decode } from "lib/jwt";

const authentication: MiddlewareFn<IContext> = async ({ context }, next) => {
  const token = context.auth?.split(" ")[1];

  if (!token) {
    throw new Error("Unauthenticated");
  }

  context.identity = decode(token) as any;

  return next();
};

export default authentication;
