import { useParams } from 'react-router-dom'

import ReceiveView from './ReceiveView'
import { useReceiveSession } from './useReceiveSession'

export default function ReceivePage() {
  const { sessionId, shortCode } = useParams<{
    sessionId: string
    shortCode: string
  }>()
  const session = useReceiveSession(sessionId ?? shortCode)
  return <ReceiveView session={session} />
}
