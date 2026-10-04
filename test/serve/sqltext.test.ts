import { expect, test } from "vitest";
import {
  createdTable,
  definesName,
  firstKeyword,
  isRead,
  statementCount,
  touchesInternal,
} from "../../src/serve/sqltext.ts";

test("statements are counted outside strings and comments", () => {
  expect(statementCount("select 1")).toBe(1);
  expect(statementCount("select 1;")).toBe(1);
  expect(statementCount("select 1;;  ")).toBe(1);
  expect(statementCount("select 1; select 2")).toBe(2);
  expect(statementCount("select ';'")).toBe(1);
  expect(statementCount('select "a;b" from t')).toBe(1);
  expect(statementCount("select 1 -- x; y\n")).toBe(1);
  expect(statementCount("select /* ; */ 1")).toBe(1);
  expect(statementCount("select 'it''s; ok'")).toBe(1);
});

test("the first keyword skips comments", () => {
  expect(firstKeyword("  /* c */ update t set x = 1")).toBe("UPDATE");
  expect(firstKeyword("-- c\nSELECT 1")).toBe("SELECT");
  expect(isRead("select 1")).toBe(true);
  expect(isRead("with x as (select 1) delete from t")).toBe(false);
  expect(isRead("pragma table_info(t)")).toBe(false);
});

test("internal tables are found in code, not in strings", () => {
  expect(touchesInternal('delete from "_yamlite_state"')).toBe(true);
  expect(touchesInternal("update _YAMLITE_COLUMNS set col = 'x'")).toBe(true);
  expect(touchesInternal("delete from _yamlite_views")).toBe(true);
  expect(touchesInternal("select * from t where x = '_yamlite_state'")).toBe(false);
});

test("the name of a created table", () => {
  expect(createdTable("create table notes(x)")).toBe("notes");
  expect(createdTable("CREATE TABLE IF NOT EXISTS main.notes (x)")).toBe("notes");
  expect(createdTable('create table "my ""t"""(x)')).toBe('my "t"');
  expect(createdTable("create table [a b](x)")).toBe("a b");
  expect(createdTable("create temp table x(a)")).toBeNull();
  expect(createdTable("create index i on t(x)")).toBeNull();
});

test("definesName finds a WITH clause that defines one of the names", () => {
  const names = ["projects__milestones"];
  expect(definesName("with projects__milestones as (select 1) select * from projects__milestones", names)).toBe(
    "projects__milestones",
  );
  expect(definesName('WITH RECURSIVE "Projects__Milestones"(a) AS MATERIALIZED (select 1) select 1', names)).toBe(
    "projects__milestones",
  );
  expect(
    definesName("with x as (select 1), [projects__milestones] as not materialized (select 2) select 1", names),
  ).toBe("projects__milestones");
  expect(definesName("with x as (select * from projects__milestones) select * from x", names)).toBeNull();
  expect(definesName("select 'projects__milestones as (' from t", names)).toBeNull();
  expect(definesName("select * from my_projects__milestones as (x)", names)).toBeNull();
});

test("definesName sees single-quoted names and column lists with quoted parentheses", () => {
  const names = ["projects__milestones"];
  expect(definesName("with 'projects__milestones' as (select 1) select 1", names)).toBe("projects__milestones");
  expect(definesName('with projects__milestones("a)") as (select 1) select 1', names)).toBe("projects__milestones");
  expect(definesName("with projects__milestones(a,\n  b\n) as (select 1, 2) select 1", names)).toBe(
    "projects__milestones",
  );
  expect(definesName("select 'a projects__milestones as (' from t", names)).toBeNull();
});
