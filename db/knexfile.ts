import { Knex } from "knex";

const configuration: Knex.Config = {
  client: "pg",
  connection: {
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DATABASE,
  },
  migrations: {
    tableName: "knex_migrations",
    directory: "./migrations",
  },
  seeds: {
    directory: "./seeds",
  },
};

export default require("knex-stringcase")(configuration);
