import { useParams } from 'react-router-dom'

import ReceiveView from './ReceiveView'
import { useReceiveSession } from './useReceiveSession'

export default function ReceivePage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const session = useReceiveSession(sessionId)
  return <ReceiveView session={session} />
}
