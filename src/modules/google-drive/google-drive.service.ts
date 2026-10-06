import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, drive_v3 } from 'googleapis';
import { Readable } from 'node:stream';
import { Cron } from '@nestjs/schedule';
import { RedisService } from 'src/common/cache/redis.service';

const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_CACHE_TTL_SECONDS = 300;
const DRIVE_TREE_CACHE_PREFIX = 'google-drive:tree:v2:';
const DRIVE_FILE_CACHE_PREFIX = 'google-drive:file:v3:';
export interface DriveTreeItem {
  id: string;
  name: string;
  type: 'folder' | 'file';
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  path?: string[];
  children?: DriveTreeItem[];
}

@Injectable()
export class GoogleDriveService {
  private drive?: drive_v3.Drive;
  private readonly logger = new Logger(GoogleDriveService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  private getDrive() {
    const email = this.configService.get<string>(
      'google.driveServiceAccountEmail',
    );
    const privateKey = this.configService.get<string>(
      'google.driveServiceAccountPrivateKey',
    );

    if (!email || !privateKey) {
      throw new ServiceUnavailableException(
        'Google Drive is not configured. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL and GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY.',
      );
    }

    if (this.drive) {
      return this.drive;
    }

    const auth = new google.auth.JWT({
      email,
      key: privateKey.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });

    this.drive = google.drive({ version: 'v3', auth });
    return this.drive;
  }

  private getRootFolderId() {
    const folderId = this.configService.get<string>('google.driveFolderId');
    if (!folderId) {
      throw new ServiceUnavailableException(
        'GOOGLE_DRIVE_FOLDER_ID has not been configured.',
      );
    }
    return folderId;
  }

  private async listChildren(folderId: string, search?: string) {
    const files: drive_v3.Schema$File[] = [];
    let pageToken: string | undefined;
    const nameQuery = search?.trim()
      ? ` and name contains '${this.escapeDriveQueryValue(search.trim())}'`
      : '';

    do {
      const response = await this.getDrive().files.list({
        q: `'${folderId}' in parents and trashed = false${nameQuery}`,
        fields:
          'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,parents)',
        orderBy: 'folder,name',
        pageSize: 1000,
        pageToken,
        spaces: 'drive',
      });
      files.push(
        ...(response.data.files ?? []).filter(
          (file) =>
            file.name?.trim().replace(/^\./, '').toLowerCase() !== 'obsidian',
        ),
      );
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return files;
  }

  private toItem(file: drive_v3.Schema$File): DriveTreeItem {
    const isFolder = file.mimeType === GOOGLE_FOLDER_MIME;
    return {
      id: file.id ?? '',
      name: file.name ?? '',
      type: isFolder ? 'folder' : 'file',
      mimeType: file.mimeType ?? undefined,
      size: file.size ?? undefined,
      modifiedTime: file.modifiedTime ?? undefined,
      webViewLink: file.webViewLink ?? undefined,
    };
  }

  async listFiles(search?: string, folderId = this.getRootFolderId()) {
    const cacheKey = `${DRIVE_TREE_CACHE_PREFIX}children:${folderId}:${search?.trim().toLowerCase() ?? '*'}`;
    const cached = await this.redisService.get<DriveTreeItem[]>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const items = (await this.listChildren(folderId, search)).map((file) =>
        this.toItem(file),
      );
      await this.redisService.set(cacheKey, items, DRIVE_CACHE_TTL_SECONDS);
      return items;
    } catch (error) {
      throw new ServiceUnavailableException(
        'Unable to read files from Google Drive.',
        { cause: error },
      );
    }
  }

  async getTree(folderId = this.getRootFolderId()): Promise<DriveTreeItem> {
    const cacheKey = `${DRIVE_TREE_CACHE_PREFIX}${folderId}`;
    const cached = await this.redisService.get<DriveTreeItem>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const tree = await this.buildTree(folderId);
      await this.redisService.set(cacheKey, tree, DRIVE_CACHE_TTL_SECONDS);
      return tree;
    } catch (error) {
      throw new ServiceUnavailableException(
        'Unable to read the Google Drive folder tree.',
        { cause: error },
      );
    }
  }

  private async buildTree(folderId: string): Promise<DriveTreeItem> {
    const folder = await this.getFile(folderId);
    const children = await this.listChildren(folderId);
    const items: DriveTreeItem[] = [];

    for (const child of children) {
      const item = this.toItem(child);
      if (item.type === 'folder') {
        items.push(await this.buildTree(item.id));
      } else {
        items.push(item);
      }
    }

    return { ...this.toItem(folder), type: 'folder', children: items };
  }

  @Cron('*/5 * * * *')
  async refreshRootTree() {
    const rootFolderId = this.configService.get<string>('google.driveFolderId');
    if (!rootFolderId || !this.configService.get<string>('REDIS_URL')) {
      return;
    }

    try {
      const tree = await this.buildTree(rootFolderId);
      await this.redisService.set(
        `${DRIVE_TREE_CACHE_PREFIX}${rootFolderId}`,
        tree,
        DRIVE_CACHE_TTL_SECONDS,
      );
      this.logger.log('Google Drive tree cache refreshed.');
    } catch (error) {
      this.logger.error('Unable to refresh Google Drive tree cache.', error);
    }
  }

  async searchFiles(search: string, folderId = this.getRootFolderId()) {
    const tree = await this.getTree(folderId);
    const results: DriveTreeItem[] = [];
    const normalized = search.trim().toLowerCase();

    const visit = (item: DriveTreeItem, path: string[]) => {
      const currentPath = [...path, item.name];
      if (
        item.type === 'file' &&
        item.name.toLowerCase().includes(normalized)
      ) {
        results.push({ ...item, path: currentPath.slice(1) });
      }
      item.children?.forEach((child) => visit(child, currentPath));
    };
    tree.children?.forEach((child) => visit(child, []));
    return results;
  }

  async getFile(fileId: string) {
    const cacheKey = `${DRIVE_FILE_CACHE_PREFIX}${fileId}`;
    const cached = await this.redisService.get<drive_v3.Schema$File>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.getDrive().files.get({
        fileId,
        fields: 'id,name,mimeType,size,modifiedTime,webViewLink,parents',
      });
      await this.redisService.set(
        cacheKey,
        response.data,
        DRIVE_CACHE_TTL_SECONDS,
      );
      return response.data;
    } catch (error) {
      throw new ServiceUnavailableException(
        'Unable to read the file from Google Drive.',
        { cause: error },
      );
    }
  }

  async getFileContent(fileId: string) {
    const cacheKey = `${DRIVE_FILE_CACHE_PREFIX}content:${fileId}`;
    const cached = await this.redisService.get<{
      id: string | null | undefined;
      name: string | null | undefined;
      mimeType: string | null | undefined;
      modifiedTime: string | null | undefined;
      content: string;
      audioFiles: (DriveTreeItem & { streamUrl: string })[];
    }>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const metadata = await this.getFile(fileId);
      const response = await this.getDrive().files.get(
        { fileId, alt: 'media' },
        { responseType: 'text' },
      );
      const content =
        typeof response.data === 'string'
          ? response.data
          : JSON.stringify(response.data);
      const audioFiles = await this.findReferencedAudio(metadata, content);

      const result = {
        id: metadata.id,
        name: metadata.name,
        mimeType: metadata.mimeType,
        modifiedTime: metadata.modifiedTime,
        content,
        audioFiles,
      };
      await this.redisService.set(cacheKey, result, DRIVE_CACHE_TTL_SECONDS);
      return result;
    } catch (error) {
      throw new ServiceUnavailableException(
        'Unable to read file content from Google Drive.',
        { cause: error },
      );
    }
  }

  async getLesson(fileId: string) {
    const content = await this.getFileContent(fileId);
    return {
      id: content.id,
      title: content.name?.replace(/\.(md|markdown|txt)$/i, '') ?? '',
      mimeType: content.mimeType,
      markdown: content.content,
      audios: content.audioFiles,
    };
  }

  async streamFile(fileId: string) {
    try {
      const metadata = await this.getFile(fileId);
      const response = await this.getDrive().files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' },
      );
      return {
        metadata,
        stream: response.data as unknown as Readable,
      };
    } catch (error) {
      throw new ServiceUnavailableException(
        'Unable to stream the file from Google Drive.',
        { cause: error },
      );
    }
  }

  private async findReferencedAudio(
    markdownFile: drive_v3.Schema$File,
    content: string,
  ) {
    const markdownLinks = [
      ...content.matchAll(/\]\(([^)#?]+)(?:[#?][^)]*)?\)/g),
    ].map((match) => match[1]);
    const obsidianLinks = [
      ...content.matchAll(/!?\[\[([^|\]#]+)(?:\|[^\]]*)?\]\]/g),
    ].map((match) => match[1]);
    const references = [...new Set([...markdownLinks, ...obsidianLinks])]
      .map((name) => decodeURIComponent(name.trim()))
      .filter((name) => /\.(mp3|wav|m4a|ogg|webm)$/i.test(name))
      .map((name) => name.split('/').pop() ?? name);

    if (!references.length || !markdownFile.parents?.[0]) {
      return [];
    }

    const parentFiles = await this.listChildren(markdownFile.parents[0]);
    const audioFolder = parentFiles.find(
      (file) =>
        file.mimeType === GOOGLE_FOLDER_MIME &&
        file.name?.toLowerCase() === 'audio',
    );
    if (!audioFolder?.id) {
      return [];
    }

    const audioFiles = await this.listChildren(audioFolder.id);
    return references
      .map((reference) => {
        const file = audioFiles.find(
          (candidate) =>
            candidate.name?.toLowerCase() === reference.toLowerCase(),
        );
        return file
          ? {
              ...this.toItem(file),
              streamUrl: `/google-drive/files/${file.id}/stream`,
            }
          : null;
      })
      .filter((file): file is DriveTreeItem & { streamUrl: string } => !!file);
  }

  private escapeDriveQueryValue(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }
}
