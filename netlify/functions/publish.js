// "Publish all changes": merges the CMS's draft branch into main, which is the one
// build Netlify runs. Only logged-in Identity users get through (Netlify verifies the
// JWT and fills clientContext.user). Needs env vars GITHUB_TOKEN (contents: write on
// this repo) and GITHUB_REPO ("owner/name").
const gh = (path, opts = {}) =>
  fetch(`https://api.github.com/repos/${process.env.GITHUB_REPO}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
  });

const reply = (statusCode, message) => ({ statusCode, body: JSON.stringify({ message }) });

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return reply(405, "POST only");
  if (!context.clientContext || !context.clientContext.user) return reply(401, "Please log in first.");
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO) return reply(500, "Publishing isn't configured yet.");

  const merge = await gh("/merges", {
    method: "POST",
    body: JSON.stringify({ base: "main", head: "draft", commit_message: "Publish CMS edits" }),
  });
  if (merge.status === 204) return reply(200, "Nothing new to publish.");
  if (!merge.ok) return reply(502, `GitHub refused the merge (${merge.status}).`);
  const { sha } = await merge.json();

  // Put draft level with main so the next edits start from what's live.
  const sync = await gh("/git/refs/heads/draft", {
    method: "PATCH",
    body: JSON.stringify({ sha, force: true }),
  });
  if (!sync.ok) return reply(502, `Published, but resetting draft failed (${sync.status}).`);
  return reply(200, "Published. The site updates in about a minute.");
};
