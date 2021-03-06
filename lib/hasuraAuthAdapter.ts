import { Adapter } from 'next-auth/adapters';
import { Profile, Session } from 'next-auth';
import { gqlSdk } from './gql';
import { createHash } from 'crypto';
import { UserForAuthFragment } from './generated/graphql';

interface HasuraAuthOptions {}

export const HasuraAdaptor: Adapter<
  HasuraAuthOptions,
  Record<string, unknown>,
  UserForAuthFragment,
  Profile,
  Session
> = ({}) => {
  return {
    async getAdapter({ secret, ...appOptions }) {
      const addSecret = (token: string) => `${token}-${secret}`;

      const hash = (value: string) =>
        createHash('sha512').update(value).digest('hex');

      const hashToken = (token: string) => hash(addSecret(token));

      return {
        async createUser(profile) {
          const { insert_users_one } = await gqlSdk.createUserByEmail({
            email: profile.email as string,
            verified: profile?.emailVerified,
            name: profile?.name,
            image: profile?.image,
          });
          if (!insert_users_one) {
            throw new Error('Error while creating user');
          }
          return insert_users_one;
        },
        async getUser(id) {
          const { users_by_pk } = await gqlSdk.getUserById({ id });
          return users_by_pk ?? null;
        },
        async getUserByEmail(email) {
          if (!email) {
            return null;
          }
          const { users } = await gqlSdk.getUserByEmail({ email });
          return users[0] ?? null;
        },
        async getUserByProviderAccountId(providerId, providerAccountId) {
          const { accounts } = await gqlSdk.getUserByProviderAccountId({
            providerAccountId: `${providerAccountId}`,
            providerId,
          });

          const maybeUser = accounts[0]?.user ?? null;

          return maybeUser;
        },
        async updateUser(user) {
          console.log('updateUser', user);
          const maybeEmailNewTime = (user as any).emailVerified;
          if (maybeEmailNewTime) {
            const { update_users_by_pk } = await gqlSdk.setTimeEmailVerified({
              userId: user.id,
              time: maybeEmailNewTime,
            });
            if (!update_users_by_pk) {
              return user;
            }
            return update_users_by_pk;
          }
          return user;
        },
        async deleteUser(userId) {
          await gqlSdk.deleteUserById({ id: userId });
        },
        async linkAccount(
          userId,
          providerId,
          providerType,
          providerAccountId,
          refreshToken,
          accessToken,
          accessTokenExpires,
        ) {
          const compoundId = hash(`${providerId}:${providerAccountId}`);

          await gqlSdk.linkAccount({
            object: {
              user_id: userId,
              access_token: accessToken,
              access_token_expires: accessTokenExpires,
              refresh_token: refreshToken,
              provider_account_id: `${providerAccountId}`,
              provider_id: providerId,
              provider_type: providerType,
              compound_id: compoundId,
            },
          });
        },
        async unlinkAccount(userId, providerId, providerAccountId) {
          console.log('unlinkAccount', userId, providerId, providerAccountId);
          throw new Error('unlinkAccount Not implemented');
        },
        async createSession(user) {
          console.log('createSession', user);
          throw new Error('createSession Not implemented');
        },
        async getSession(sessionToken) {
          console.log('getSession', sessionToken);
          throw new Error('getSession Not implemented');
        },
        async updateSession(session, force) {
          console.log('updateSession', session, force);
          throw new Error('updateSession Not implemented');
        },
        async deleteSession(sessionToken) {
          console.log('deleteSession', sessionToken);
          throw new Error('deleteSession Not implemented');
        },
        async createVerificationRequest(
          identifier,
          url,
          token,
          secret,
          provider,
        ) {
          const { sendVerificationRequest, maxAge } = provider;

          let expires = null;
          if (maxAge) {
            const dateExpires = new Date();
            dateExpires.setTime(dateExpires.getTime() + maxAge * 1000);
            expires = dateExpires;
          }
          const hashedToken = await hashToken(token);

          await gqlSdk.createVerificationRequest({
            config: {
              identifier,
              token: hashedToken,
              url,
              expires,
            },
          });
          await sendVerificationRequest({
            identifier,
            url,
            token,
            baseUrl: appOptions.baseUrl,
            provider,
          });
        },
        async getVerificationRequest(identifier, token, secret, provider) {
          const { verification_requests } =
            await gqlSdk.getVerificationRequestByIdentifierAndToken({
              identifier,
              token: hashToken(token),
            });

          const maybeVerification = verification_requests?.[0];

          if (!maybeVerification) {
            return null;
          }

          if (
            maybeVerification?.expires &&
            new Date() > new Date(maybeVerification.expires)
          ) {
            await gqlSdk.deleteVerificationRequestByIdentifierAndToken({
              identifier,
              token: hashToken(token),
            });
            return null;
          }

          return {
            token,
            identifier,
            id: maybeVerification.id,
            expires: new Date(maybeVerification.expires),
          };
        },
        async deleteVerificationRequest(identifier, token, secret, provider) {
          await gqlSdk.deleteVerificationRequestByIdentifierAndToken({
            identifier,
            token: hashToken(token),
          });
        },
      };
    },
  };
};
