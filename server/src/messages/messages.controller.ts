import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser, requireNickname } from '../auth/auth.guard';
import { SessionUser } from '../auth/session.service';
import { MessagesService } from './messages.service';

@Controller('messages')
@UseGuards(AuthGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  async list(@CurrentUser() user: SessionUser) {
    requireNickname(user);
    return { messages: await this.messages.thread(user.id, 'user') };
  }

  @Post()
  async send(@CurrentUser() user: SessionUser, @Body() body: { text?: unknown }) {
    requireNickname(user);
    return { message: await this.messages.send(user.id, 'user', body?.text) };
  }
}
