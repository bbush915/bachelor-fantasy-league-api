import { Field, ID, Int, ObjectType } from "type-graphql";

import { SeasonWeek } from "gql/season-week";

@ObjectType()
export class Season {
  @Field(() => ID)
  id: string;

  @Field()
  createdAt?: Date;

  @Field()
  updatedAt?: Date;

  @Field(() => Int, { nullable: true })
  currentWeekNumber?: number;

  @Field(() => SeasonWeek, { nullable: true })
  currentSeasonWeek?: SeasonWeek;

  @Field()
  seriesName: string;

  @Field(() => Int)
  seasonNumber: number;

  @Field()
  isActive?: boolean;
}
