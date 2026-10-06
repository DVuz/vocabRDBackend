<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Google Drive API

Swagger is available at `http://localhost:3000/docs` (or the configured port).
Authorize with a JWT access token, then use the **Google Drive** endpoints:

- `GET /api/google-drive/files`: returns file metadata from the configured
  folder. Use `?search=lesson` to search by file name. It does not return file
  content.
- `GET /api/google-drive/files?folderId=...`: lists direct children of another
  folder.
- `GET /api/google-drive/tree`: returns the complete recursive folder tree.
  Use `?folderId=...` to start at another folder.
- `GET /api/google-drive/folders/:folderId/files`: lists direct children of a
  specific folder.
- `GET /api/google-drive/search?q=lesson`: searches file names recursively and
  returns each match with its path.
- `GET /api/google-drive/files/:fileId`: returns metadata for one file.
- `GET /api/google-drive/files/:fileId/content`: downloads a text or Markdown
  file and returns its content in the `content` field. Markdown links to files
  in a sibling `Audio` folder are resolved in the `audioFiles` field.
- `GET /api/google-drive/files/:fileId/lesson`: returns a lesson-shaped
  response with `title`, `markdown`, and resolved `audios`.
- `GET /api/google-drive/files/:fileId/stream`: streams an audio/media file.
- `GET /api/google-drive/files/:fileId/download`: downloads an audio/media
  file.

All endpoints require `Authorization: Bearer <access_token>`. The `stream`
endpoint is suitable for an HTML `<audio>` element. Audio references in
Markdown should use a relative link such as `[listen](Audio/audio-01.mp3)` or
`[listen](../Audio/audio-01.mp3)`, and the corresponding file must exist in a
folder named `Audio` beside the Markdown file.

The service reads the folder directly from Google Drive; it does not store the
file list in the database. Configure `GOOGLE_DRIVE_FOLDER_ID`,
`GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL`, and
`GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY` in `.env`, and share the folder with
the service account as a Viewer.

Google Drive metadata, the recursive tree, direct folder listings, and Markdown
lesson responses are cached in Redis for 5 minutes. Set `REDIS_URL` to enable
the cache:

```env
REDIS_URL=rediss://default:password@your-redis-host:port
```

The root tree is refreshed from Google Drive by a background cron job every
five minutes. Audio streams are not stored in Redis; they are streamed directly
from Google Drive. If `REDIS_URL` is not configured, the API continues to work
without caching and logs a warning.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
