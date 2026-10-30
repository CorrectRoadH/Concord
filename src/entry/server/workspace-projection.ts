// @concord-file
// @concord-implements docs/feature/web-workbench/architecture.md











import { GitHubRemoteFeedbackSchema, LinearRemoteFeedbackSchema } from "../../model/index.js";



const { body: _githubBody, ...githubFields } = GitHubRemoteFeedbackSchema.fields;
const { body: _linearBody, ...linearFields } = LinearRemoteFeedbackSchema.fields;
