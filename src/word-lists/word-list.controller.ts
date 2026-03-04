import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WordListService } from './word-list.service';
import type { JwtPayload } from '../auth/jwt-auth.guard';

@Controller()
export class WordListController {
  constructor(private readonly wordListService: WordListService) {}

  // ── JWT-protected "mine" routes ─────────────────────────────────────────

  /** GET /my/word-lists – get current user's word lists */
  @Get('my/word-lists')
  @UseGuards(JwtAuthGuard)
  async getMyWordLists(@CurrentUser() user: JwtPayload) {
    return this.wordListService.getWordLists(user.sub);
  }

  /** POST /my/word-lists – create a new word list for current user */
  @Post('my/word-lists')
  @UseGuards(JwtAuthGuard)
  async createMyWordList(
    @CurrentUser() user: JwtPayload,
    @Body('name') name: string,
    @Body('description') description?: string
  ) {
    return this.wordListService.createWordList(user.sub, name, description);
  }

  /** POST /my/word-lists/:listId/items – add a meaning to one of my lists */
  @Post('my/word-lists/:listId/items')
  @UseGuards(JwtAuthGuard)
  async addToMyList(
    @CurrentUser() _user: JwtPayload,
    @Param('listId') listId: string,
    @Body('wordMeaningId') wordMeaningId: number
  ) {
    return this.wordListService.addMeaningToList(parseInt(listId), wordMeaningId);
  }

  // ── Legacy user-scoped routes ────────────────────────────────────────────

  @Post('users/:userId/word-lists')
  async createWordList(
    @Param('userId') userId: string,
    @Body('name') name: string,
    @Body('description') description?: string
  ) {
    return this.wordListService.createWordList(parseInt(userId), name, description);
  }

  @Get('users/:userId/word-lists')
  async getWordLists(@Param('userId') userId: string) {
    return this.wordListService.getWordLists(parseInt(userId));
  }

  @Post('word-lists/:listId/items')
  async addMeaning(@Param('listId') listId: string, @Body('wordMeaningId') wordMeaningId: number) {
    return this.wordListService.addMeaningToList(parseInt(listId), wordMeaningId);
  }

  @Delete('word-lists/:listId/items/:meaningId')
  async removeMeaning(@Param('listId') listId: string, @Param('meaningId') meaningId: string) {
    return this.wordListService.removeMeaningFromList(parseInt(listId), parseInt(meaningId));
  }

  @Delete('word-lists/:listId')
  async deleteWordList(@Param('listId') listId: string) {
    return this.wordListService.deleteWordList(parseInt(listId));
  }
}
