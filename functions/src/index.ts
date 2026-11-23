import { setGlobalOptions } from 'firebase-functions/v2'
import { REGION } from './lib/options'

setGlobalOptions({ region: REGION, maxInstances: 10 })

export { callWaiter, attendCall, closeTable, escalateCalls } from './calls'
export { adminCreateUser, adminUpdateUser, adminSetPassword } from './staff'
export { adminCreateInvite, redeemInvite } from './invites'
export { trackEvent } from './stats'
export { createOrder, setOrderStatus } from './orders'
