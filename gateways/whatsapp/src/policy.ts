import type { ApexConfig } from '@apex/core'
import { isChannelSubjectApproved } from '@apex/core'

export function isWhatsAppMessageAuthorized(
  chatId: string,
  authorId: string,
  whatsappConfig: ApexConfig['gateways']['whatsapp'],
): boolean {
  const isGroup = chatId.endsWith('@g.us')

  if (!isGroup) {
    return isChannelSubjectApproved('whatsapp', chatId, whatsappConfig.allowFrom)
  }

  if (whatsappConfig.groupPolicy === 'open') {
    return true
  }

  if (whatsappConfig.groupPolicy === 'disabled') {
    return false
  }

  return isChannelSubjectApproved(
    'whatsapp',
    authorId,
    whatsappConfig.groupAllowFrom.length > 0 ? whatsappConfig.groupAllowFrom : whatsappConfig.allowFrom,
  )
}
