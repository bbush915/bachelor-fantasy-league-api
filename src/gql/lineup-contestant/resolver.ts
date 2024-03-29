import { Arg, FieldResolver, ID, Int, Resolver, Root } from "type-graphql";

import { Contestant } from "gql/contestant";
import knex from "lib/knex";
import { DbContestant, DbSeasonWeekContestant } from "types";
import { LineupContestant } from "./schema";

@Resolver(LineupContestant)
class LineupContestantResolver {
  @FieldResolver(() => Contestant)
  async contestant(@Root() { contestantId }: LineupContestant): Promise<DbContestant> {
    const contestant = await knex
      .select()
      .from<DbContestant>("contestants")
      .where({ id: contestantId })
      .first();

    return contestant!;
  }

  @FieldResolver(() => Int, { nullable: true })
  async score(
    @Arg("seasonWeekId", () => ID) seasonWeekId: string,
    @Root() { contestantId }: LineupContestant
  ): Promise<number | undefined> {
    const seasonWeekContestant = await knex
      .select()
      .from<DbSeasonWeekContestant>("season_week_contestants")
      .where({ seasonWeekId, contestantId })
      .first();

    return seasonWeekContestant!.score;
  }
}

export default LineupContestantResolver;
