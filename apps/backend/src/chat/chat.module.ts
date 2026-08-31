import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';

// StorageService and NotificationsService both come from @Global() modules, so
// neither is imported here — the point is that chat reuses them rather than
// standing up its own upload or delivery path.
@Module({
  controllers: [ChatController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService, ChatGateway],
})
export class ChatModule {}
