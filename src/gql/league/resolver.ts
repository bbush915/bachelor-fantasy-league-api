import { ApolloError } from "apollo-server-koa";
import {
  Arg,
  Args,
  Ctx,
  FieldResolver,
  ID,
  Mutation,
  Query,
  Resolver,
  Root,
  UseMiddleware,
} from "type-graphql";

import configuration from "configuration";
import { IContext } from "gql/context";
import { LeagueMember } from "gql/league-member";
import { Season } from "gql/season";
import { OperationResponse } from "gql/utils";
import { decode, encode } from "lib/jwt";
import knex from "lib/knex";
import { authentication } from "middleware";
import { DbLeague, DbLeagueMember, DbSeason } from "types";
import {
  CreateLeagueInput,
  DeleteLeagueInput,
  League,
  UpdateLeagueInput,
  ValidateLeagueAccessibilityInput,
  ValidateLeagueMembershipInput,
} from "./schema";

@Resolver(League)
class LeagueResolver {
  @Query(() => [League])
  async leagues(@Arg("query") query: string): Promise<DbLeague[]> {
    const activeSeason = await knex
      .select()
      .from<DbSeason>("seasons")
      .where({ isActive: true })
      .first();

    // ASSUMPTION - There will always be an active season.

    return knex
      .select()
      .from<DbLeague>("leagues")
      .where("season_id", "=", activeSeason!.id)
      .andWhere("is_public", "=", true)
      .andWhereRaw(`lower(leagues.name) LIKE '%${query.toLowerCase()}%'`)
      .orderBy("name")
      .limit(10);
  }

  @Query(() => League)
  async league(@Arg("id", () => ID) id: string): Promise<DbLeague> {
    const league = await knex.select().from<DbLeague>("leagues").where({ id }).first();

    if (!league) {
      throw new Error("League does not exist");
    }

    return league;
  }

  @Query(() => OperationResponse)
  @UseMiddleware(authentication)
  async validateLeagueMembership(
    @Args() { leagueId }: ValidateLeagueMembershipInput,
    @Ctx() { identity }: IContext
  ): Promise<OperationResponse> {
    const leagueMember = await knex
      .select()
      .from<DbLeagueMember>("league_members")
      .where({ leagueId, userId: identity!.id, isActive: true })
      .first();

    return {
      success: !!leagueMember,
    };
  }

  @Query(() => OperationResponse)
  async validateLeagueAccessibility(
    @Args() { leagueId, authenticationToken, accessToken }: ValidateLeagueAccessibilityInput
  ): Promise<OperationResponse> {
    // NOTE - If the user is already a member of the league (active or not),
    // then they have access to its details.

    if (authenticationToken) {
      const { id: userId }: any = decode(authenticationToken);

      const leagueMember = await knex
        .select()
        .from<DbLeagueMember>("league_members")
        .where({ leagueId, userId })
        .first();

      if (!!leagueMember) {
        return {
          success: true,
        };
      }
    }

    // NOTE - In all other cases, a user will only have access to league
    // details in the following circumstances:
    //
    // 1. The league is public.
    // 2. The league is shareable, and they have a token from a league member.
    // 3. They have a token from the league commissioner.

    const league = await knex.select().from<DbLeague>("leagues").where({ id: leagueId }).first();

    if (!league) {
      throw new Error("League does not exist");
    }

    // NOTE - Rule 1

    if (league.isPublic) {
      return {
        success: true,
      };
    }

    // NOTE - Validate access token.

    if (!accessToken) {
      return {
        success: false,
      };
    }

    const { action, payload }: any = decode(accessToken);

    if (action !== "join-league") {
      return {
        success: false,
      };
    }

    // NOTE - Rules 2 & 3

    const { referrer } = payload;

    const leagueMember = await knex
      .select()
      .from<DbLeagueMember>("league_members")
      .where({ leagueId, userId: referrer })
      .first();

    return {
      success: !!leagueMember && (leagueMember.isCommissioner || league.isShareable),
    };
  }

  @Query(() => [League])
  @UseMiddleware(authentication)
  myLeagues(@Ctx() { identity }: IContext): Promise<DbLeague[]> {
    return knex
      .select("leagues.*")
      .from<DbLeague>("leagues")
      .join("league_members", "league_members.league_id", "=", "leagues.id")
      .where("league_members.user_id", "=", identity!.id);
  }

  @FieldResolver(() => Season)
  async season(@Root() { seasonId }: League): Promise<DbSeason> {
    const season = await knex.select().from<DbSeason>("seasons").where({ id: seasonId }).first();
    return season!;
  }

  @FieldResolver(() => [LeagueMember])
  leagueMembers(@Root() { id }: League): Promise<DbLeagueMember[]> {
    return knex.select().from<DbLeagueMember>("league_members").where({ leagueId: id });
  }

  @FieldResolver(() => LeagueMember)
  async commissioner(@Root() { id }: League): Promise<DbLeagueMember> {
    const commissioner = await knex
      .select()
      .from<DbLeagueMember>("league_members")
      .where({ leagueId: id, isCommissioner: true })
      .first();

    return commissioner!;
  }

  @FieldResolver(() => LeagueMember, { nullable: true })
  @UseMiddleware(authentication)
  myLeagueMember(
    @Root() { id }: League,
    @Ctx() { identity }: IContext
  ): Promise<DbLeagueMember | undefined> {
    return knex
      .select()
      .from<DbLeagueMember>("league_members")
      .where({ leagueId: id, userId: identity!.id })
      .first();
  }

  @FieldResolver(() => String, { nullable: true })
  @UseMiddleware(authentication)
  async inviteLink(
    @Root() { id, isShareable }: League,
    @Ctx() { identity }: IContext
  ): Promise<string> {
    const leagueMember = await knex
      .select()
      .from<DbLeagueMember>("league_members")
      .where({ leagueId: id, userId: identity!.id })
      .first();

    if (!leagueMember) {
      throw new Error("You are not a member of this league");
    }

    if (!isShareable && !leagueMember.isCommissioner) {
      throw new Error("You do not have permission to share this league");
    }

    const token = encode({ action: "join-league", payload: { referrer: identity!.id } });
    return `${configuration.client.host}/leagues/${id}/info?token=${token}`;
  }

  @Mutation(() => League)
  @UseMiddleware(authentication)
  async createLeague(
    @Arg("input") { name, description, logo, isPublic, isShareable }: CreateLeagueInput,
    @Ctx() { identity }: IContext
  ): Promise<DbLeague> {
    const activeSeason = await knex
      .select()
      .from<DbSeason>("seasons")
      .where({ isActive: true })
      .first();

    // ASSUMPTION - There will always be an active season.

    const existingLeague = await knex
      .select()
      .from<DbLeague>("leagues")
      .where({ seasonId: activeSeason!.id, name })
      .first();

    if (existingLeague) {
      throw new ApolloError(`A league with that name already exists.`, "LEAGUE_ALREADY_EXISTS");
    }

    return knex.transaction(async (trx) => {
      // TODO(Bryan) - Should store logo somewhere (S3 or local file system).
      // Currently keeping a data URL, which works, but ¯\_(ツ)_/¯

      const logoUrl = logo;

      const league = (
        await trx<DbLeague>("leagues")
          .insert({
            seasonId: activeSeason!.id,
            name,
            description,
            logoUrl,
            isPublic,
            isShareable,
          })
          .returning("*")
      )[0];

      // NOTE - The user who creates the league is the commissioner.

      const commissioner: Partial<DbLeagueMember> = {
        leagueId: league.id,
        userId: identity!.id,
        isCommissioner: true,
      };

      await trx<DbLeagueMember>("league_members").insert(commissioner);

      return league;
    });
  }

  @Mutation(() => League)
  @UseMiddleware(authentication)
  async updateLeague(
    @Arg("input") { id, name, description, logo, isPublic, isShareable }: UpdateLeagueInput,
    @Ctx() { identity }: IContext
  ): Promise<DbLeague> {
    const comissioner = await knex
      .select()
      .from<DbLeagueMember>("league_members")
      .where({ leagueId: id, isCommissioner: true })
      .first();

    if (identity!.id !== comissioner?.userId) {
      throw new Error("You are not authorized to update this league");
    }

    const activeSeason = await knex
      .select()
      .from<DbSeason>("seasons")
      .where({ isActive: true })
      .first();

    // ASSUMPTION - There will always be an active season.

    const existingLeague = await knex
      .select()
      .from<DbLeague>("leagues")
      .where({ seasonId: activeSeason!.id, name })
      .andWhere("id", "<>", id)
      .first();

    if (existingLeague) {
      throw new ApolloError(`A league with that name already exists.`, "LEAGUE_ALREADY_EXISTS");
    }

    const logoUrl = logo;

    return (
      await knex<DbLeague>("leagues")
        .update({
          name,
          description,
          logoUrl,
          isPublic,
          isShareable,
        })
        .where({ id })
        .returning("*")
    )[0];
  }

  @Mutation(() => OperationResponse)
  @UseMiddleware(authentication)
  async deleteLeague(
    @Arg("input") { id }: DeleteLeagueInput,
    @Ctx() { identity }: IContext
  ): Promise<OperationResponse> {
    const comissioner = await knex
      .select()
      .from<DbLeagueMember>("league_members")
      .where({ leagueId: id, isCommissioner: true })
      .first();

    if (identity!.id !== comissioner?.userId) {
      throw new Error("You are not authorized to delete this league");
    }

    await knex.transaction(async (trx) => {
      // NOTE - Delete lineup contestants.
      await trx.raw(
        `
          WITH src AS (
            SELECT
              LC.id
            FROM
              lineup_contestants LC
              JOIN lineups L ON (L.id = LC.lineup_id)
              JOIN league_members LM ON (LM.id = L.league_member_id)
            WHERE
              1 = 1
              AND (LM.league_id = ?)
          )
          DELETE FROM
            lineup_contestants LC
          USING
            src
          WHERE
            1 = 1
            AND (src.id = LC.id)
        `,
        [id]
      );

      // NOTE-  Delete lineups.
      await trx.raw(
        `
          WITH src AS (
            SELECT
              L.id
            FROM
              lineups L
              JOIN league_members LM ON (LM.id = L.league_member_id)
            WHERE
              1 = 1
              AND (LM.league_id = ?)
          )
          DELETE FROM
            lineups L
          USING
            src
          WHERE
            1 = 1
            AND (src.id = L.id)
        `,
        [id]
      );

      // NOTE - Delete league members.
      await trx<LeagueMember>("league_members").delete().where({ leagueId: id });

      // NOTE - Delete league.
      await trx<League>("leagues").delete().where({ id });
    });

    return {
      success: true,
    };
  }
}

export default LeagueResolver;
