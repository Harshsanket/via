import SendView from './SendView'
import { useSendSession } from './useSendSession'

export default function SendPage() {
  const session = useSendSession()
  return <SendView session={session} />
}
