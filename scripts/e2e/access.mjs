/**
 * Who may do what, and the `JDBC` task.
 *
 * The access rules are grouped here because they are all the same shape: an
 * allow case is nearly worthless on its own, since a permission system that
 * grants everything passes every allow test ever written. Each one below is
 * therefore paired with the *denial* it exists to produce.
 *
 * `JDBC` shares the section for a related reason — the property worth proving
 * is not that a query runs but that a workflow cannot choose which database it
 * runs against.
 */
import { NS, call, check, finish, register, section, signIn, start, unique } from './harness.mjs';

const inline = (ref, expression, extra = {}) => ({
  name: ref,
  taskReferenceName: ref,
  type: 'INLINE',
  inputParameters: { expression, ...extra },
});

export async function run() {
  await groups();
  await tagBasedAccess();
  await resourceGrants();
  await savedViews();
  await jdbcTask();
}

async function groups() {
  section('groups');
  const name = unique('e2e_group');

  const created = await call('POST', `/v1/ns/${NS}/groups`, {
    body: { name, description: 'for the end-to-end suite' },
  });
  check('created', created.status < 300, `${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);

  const scoped = await call('PUT', `/v1/ns/${NS}/groups/${name}/scopes`, {
    body: { scopes: ['executions:read'] },
  });
  check('scopes settable', scoped.status < 300, `${scoped.status} ${JSON.stringify(scoped.body).slice(0, 200)}`);

  const listed = await call('GET', `/v1/ns/${NS}/groups`, {});
  const rows = listed.body?.groups ?? listed.body ?? [];
  check('listed', Array.isArray(rows) && rows.some((g) => g.name === name), JSON.stringify(listed.body).slice(0, 180));

  const fetched = await call('GET', `/v1/ns/${NS}/groups/${name}`, {});
  check('its scopes round-trip', (fetched.body?.scopes ?? []).includes('executions:read'), JSON.stringify(fetched.body).slice(0, 200));

  await call('DELETE', `/v1/ns/${NS}/groups/${name}`, {});
}

/**
 * A person in a group, signed in.
 *
 * Tag grants live on *groups*, not on credentials — an API key carries scopes
 * and nothing else. Testing tag isolation with a key therefore proves nothing:
 * the key has no grants at all, so every read is refused and the deny case
 * passes for the wrong reason. This builds the real subject.
 */
async function personInGroupWith(tagGrants) {
  const group = unique('e2e_team');
  const email = `${unique('member')}@example.com`;
  const password = 'Tumbling-Quartz-7741';

  await call('POST', `/v1/ns/${NS}/groups`, { body: { name: group } });
  await call('PUT', `/v1/ns/${NS}/groups/${group}/scopes`, {
    body: { scopes: ['workflows:read', 'executions:read'] },
  });
  const granted = await call('PUT', `/v1/ns/${NS}/groups/${group}/tag-grants`, { body: { tagGrants } });

  const user = await call('POST', `/v1/ns/${NS}/users`, {
    body: { email, name: 'E2E Member', password, scopes: [] },
  });
  const userId = user.body?.id ?? user.body?.user?.id;
  const added = userId
    ? await call('POST', `/v1/ns/${NS}/groups/${group}/members`, { body: { userId } })
    : { status: 500 };

  return {
    group,
    ok: granted.status < 300 && user.status < 300 && added.status < 300,
    detail: `grants=${granted.status} user=${user.status} member=${added.status}`,
    signIn: () => signIn(email, password),
  };
}

async function tagBasedAccess() {
  section('tag-based access');
  const mine = unique('e2e_mine');
  const theirs = unique('e2e_theirs');

  await register({ name: mine, tags: ['team:payments'], tasks: [inline('a', 'return { ok: true };')] });
  await register({ name: theirs, tags: ['team:search'], tasks: [inline('a', 'return { ok: true };')] });

  const person = await personInGroupWith(['team:payments']);
  check('a group with a tag grant and a member in it', person.ok, person.detail);
  if (!person.ok) return;

  const asThem = await person.signIn();

  const own = await asThem('GET', `/v1/ns/${NS}/metadata/workflows/${mine}`);
  check('they can read their own team’s workflow', own.status === 200, `${own.status}`);

  // The half that matters: the grant must not reach past its own tag.
  const other = await asThem('GET', `/v1/ns/${NS}/metadata/workflows/${theirs}`);
  check('and not another team’s', other.status === 403 || other.status === 404, `${other.status}`);

  const listed = await asThem('GET', `/v1/ns/${NS}/metadata/workflows`);
  const names = (listed.body?.workflows ?? listed.body ?? []).map((w) => w.name);
  check('the listing hides it too, not just the direct read', !names.includes(theirs), names.slice(0, 8).join(','));
}

async function resourceGrants() {
  section('resource grants');
  const locked = unique('e2e_locked');
  await register({ name: locked, tags: ['team:search'], tasks: [inline('a', 'return { ok: true };')] });

  // Someone with no grant on this tag at all.
  const person = await personInGroupWith(['team:payments']);
  check('a person to grant to', person.ok, person.detail);
  if (!person.ok) return;

  const asThem = await person.signIn();
  const before = await asThem('GET', `/v1/ns/${NS}/metadata/workflows/${locked}`);
  check('not reachable before the grant', before.status === 403 || before.status === 404, `${before.status}`);

  const groups = await call('GET', `/v1/ns/${NS}/groups/${person.group}`, {});
  const groupId = groups.body?.id;
  const granted = groupId
    ? await call('PUT', `/v1/ns/${NS}/permissions`, {
        body: {
          subjectType: 'GROUP',
          subjectId: groupId,
          resourceType: 'WORKFLOW',
          resource: locked,
          access: ['READ'],
        },
      })
    : { status: 500, body: groups.body };
  check('a grant can name one resource', granted.status < 300, `${granted.status} ${JSON.stringify(granted.body).slice(0, 220)}`);

  if (granted.status < 300) {
    const after = await asThem('GET', `/v1/ns/${NS}/metadata/workflows/${locked}`);
    check('and it opens exactly that resource', after.status === 200, `${after.status}`);

    // A grant is for one resource, not a promotion.
    const another = unique('e2e_stillclosed');
    await register({ name: another, tags: ['team:search'], tasks: [inline('a', 'return { ok: true };')] });
    const stillClosed = await asThem('GET', `/v1/ns/${NS}/metadata/workflows/${another}`);
    check('and nothing else', stillClosed.status === 403 || stillClosed.status === 404, `${stillClosed.status}`);
  }
}

async function savedViews() {
  section('saved views');
  const name = unique('e2e_view');

  const created = await call('POST', `/v1/ns/${NS}/saved-views`, {
    body: { page: 'executions', name, state: { status: ['FAILED'], limit: 25 }, shared: false },
  });
  check('created', created.status < 300, `${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);

  const listed = await call('GET', `/v1/ns/${NS}/saved-views?page=executions`, {});
  const rows = listed.body?.views ?? listed.body?.savedViews ?? listed.body ?? [];
  check('listed', Array.isArray(rows) && rows.some((v) => v.name === name), JSON.stringify(listed.body).slice(0, 200));

  const id = created.body?.id;
  if (id) await call('DELETE', `/v1/ns/${NS}/saved-views/${id}`, {});
}

async function jdbcTask() {
  section('JDBC task');
  const name = unique('e2e_sql');

  await register({
    name,
    tasks: [
      {
        name: 'query',
        taskReferenceName: 'query',
        type: 'JDBC',
        inputParameters: {
          datasource: 'reporting',
          statement: 'SELECT 1 + 1 AS answer',
        },
      },
    ],
    outputParameters: { answer: '${query.output.rows[0].answer}' },
  });

  const run = await finish(await start(name), 60_000);

  if (run.status !== 'COMPLETED' && /datasource/i.test(String(run.reasonForIncompletion))) {
    check(
      'a datasource is configured',
      false,
      'set NODE_FLOW_SQL_DATASOURCES for this section — see index.mjs'
    );
  } else {
    check('the query ran', run.status === 'COMPLETED', `${run.status} ${run.reasonForIncompletion ?? ''}`);
    check('and its rows are readable downstream', Number(run.output?.answer) === 2, JSON.stringify(run.output));
  }

  // The property that matters more than the query: a definition is user input,
  // so it names a datasource the *operator* configured and cannot supply its
  // own connection string.
  const sneaky = unique('e2e_sql_sneaky');
  await register({
    name: sneaky,
    tasks: [
      {
        name: 'query',
        taskReferenceName: 'query',
        type: 'JDBC',
        inputParameters: {
          datasource: 'postgres://someone:else@evil.example/db',
          statement: 'SELECT 1',
        },
      },
    ],
  });

  const refused = await finish(await start(sneaky), 60_000);
  check(
    'a workflow cannot name its own database',
    refused.status === 'FAILED',
    `${refused.status} ${refused.reasonForIncompletion ?? ''}`
  );
}
