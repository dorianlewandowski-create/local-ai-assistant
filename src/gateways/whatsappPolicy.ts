import { OpenMacConfig } from '../config';
import { isChannelSubjectApproved } from '../security/channelPairingStore';

export function isWhatsAppMessageAuthorized(
  chatId: string,
  authorId: string,
  whatsappConfig: OpenMacConfig['gateways']['whatsapp'],
): boolean {
  const isGroup = chatId.endsWith('@g.us');

  if (!isGroup) {
    return isChannelSubjectApproved('whatsapp', chatId, whatsappConfig.allowFrom);
  }

  if (whatsappConfig.groupPolicy === 'open') {
    return true;
  }

  if (whatsappConfig.groupPolicy === 'disabled') {
    return false;
  }

  return isChannelSubjectApproved('whatsapp', authorId, whatsappConfig.groupAllowFrom.length > 0 ? whatsappConfig.groupAllowFrom : whatsappConfig.allowFrom);
}
