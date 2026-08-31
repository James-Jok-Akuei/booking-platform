import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { CHAT_REALTIME } from './chat-realtime.interface';

// StorageService and NotificationsService both come from @Global() modules, so
// neither is imported here — the point is that chat reuses them rather than
// standing up its own upload or delivery path.
@Module({
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatGateway,
    // The gateway IS the realtime publisher. Bound to the token so ChatService
    // can depend on the capability without importing the gateway.
    { provide: CHAT_REALTIME, useExisting: ChatGateway },
  ],
  exports: [ChatService, ChatGateway],
})
export class ChatModule {}
