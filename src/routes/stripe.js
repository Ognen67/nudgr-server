// import express from 'express';
// import Stripe from 'stripe';
// import { PrismaClient } from '@prisma/client';
// // import { authMiddleware, getUserFromAuth } from '../middleware/auth.js';

// const router = express.Router();
// const prisma = new PrismaClient();

// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
//   apiVersion: '2023-10-16'
// });

// // POST /api/stripe/create-checkout-session - Create a Stripe checkout session
// router.post('/create-checkout-session', authMiddleware, getUserFromAuth, async (req, res) => {
//   try {
//     const { priceId, successUrl, cancelUrl } = req.body;
//     const user = req.user;

//     if (!priceId) {
//       return res.status(400).json({ error: 'Price ID is required' });
//     }

//     // Check if user already has a Stripe customer
//     let customer;
//     const existingSubscription = await prisma.subscription.findUnique({
//       where: { userId: user.id }
//     });

//     if (existingSubscription?.stripeCustomerId) {
//       customer = await stripe.customers.retrieve(existingSubscription.stripeCustomerId);
//     } else {
//       // Create new Stripe customer
//       customer = await stripe.customers.create({
//         email: user.email,
//         name: user.name,
//         metadata: {
//           userId: user.id,
//           clerkId: user.clerkId
//         }
//       });
//     }

//     // Create checkout session
//     const session = await stripe.checkout.sessions.create({
//       customer: customer.id,
//       payment_method_types: ['card'],
//       line_items: [
//         {
//           price: priceId,
//           quantity: 1
//         }
//       ],
//       mode: 'subscription',
//       success_url: successUrl || `${process.env.VERCEL_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
//       cancel_url: cancelUrl || `${process.env.VERCEL_URL}/subscription/cancel`,
//       metadata: {
//         userId: user.id,
//         priceId: priceId
//       }
//     });

//     // Create or update subscription record
//     await prisma.subscription.upsert({
//       where: { userId: user.id },
//       update: {
//         stripeCustomerId: customer.id,
//         stripePriceId: priceId
//       },
//       create: {
//         userId: user.id,
//         stripeCustomerId: customer.id,
//         stripePriceId: priceId,
//         status: 'UNPAID'
//       }
//     });

//     res.json({
//       sessionId: session.id,
//       sessionUrl: session.url
//     });

//   } catch (error) {
//     console.error('Error creating checkout session:', error);
//     res.status(500).json({ error: 'Failed to create checkout session' });
//   }
// });

// // POST /api/stripe/create-portal-session - Create customer portal session
// router.post('/create-portal-session', authMiddleware, getUserFromAuth, async (req, res) => {
//   try {
//     const user = req.user;
//     const { returnUrl } = req.body;

//     const subscription = await prisma.subscription.findUnique({
//       where: { userId: user.id }
//     });

//     if (!subscription?.stripeCustomerId) {
//       return res.status(404).json({ error: 'No subscription found' });
//     }

//     const session = await stripe.billingPortal.sessions.create({
//       customer: subscription.stripeCustomerId,
//       return_url: returnUrl || `${process.env.VERCEL_URL}/subscription`
//     });

//     res.json({
//       sessionUrl: session.url
//     });

//   } catch (error) {
//     console.error('Error creating portal session:', error);
//     res.status(500).json({ error: 'Failed to create portal session' });
//   }
// });

// // GET /api/stripe/subscription-status - Get user's subscription status
// router.get('/subscription-status', authMiddleware, getUserFromAuth, async (req, res) => {
//   try {
//     const user = req.user;

//     const subscription = await prisma.subscription.findUnique({
//       where: { userId: user.id }
//     });

//     if (!subscription) {
//       return res.json({
//         hasSubscription: false,
//         status: null,
//         currentPeriodEnd: null,
//         priceId: null
//       });
//     }

//     // Get latest status from Stripe if we have a subscription ID
//     let stripeSubscription = null;
//     if (subscription.stripeSubscriptionId) {
//       try {
//         stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
//       } catch (stripeError) {
//         console.warn('Could not retrieve Stripe subscription:', stripeError.message);
//       }
//     }

//     res.json({
//       hasSubscription: true,
//       status: stripeSubscription?.status || subscription.status,
//       currentPeriodEnd: stripeSubscription?.current_period_end 
//         ? new Date(stripeSubscription.current_period_end * 1000) 
//         : subscription.currentPeriodEnd,
//       priceId: subscription.stripePriceId,
//       cancelAtPeriodEnd: stripeSubscription?.cancel_at_period_end || false
//     });

//   } catch (error) {
//     console.error('Error getting subscription status:', error);
//     res.status(500).json({ error: 'Failed to get subscription status' });
//   }
// });

// // POST /api/stripe/webhooks - Handle Stripe webhooks
// router.post('/webhooks', express.raw({ type: 'application/json' }), async (req, res) => {
//   const sig = req.headers['stripe-signature'];
//   let event;

//   try {
//     event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
//   } catch (err) {
//     console.error('Webhook signature verification failed:', err.message);
//     return res.status(400).send(`Webhook Error: ${err.message}`);
//   }

//   try {
//     switch (event.type) {
//       case 'checkout.session.completed':
//         await handleCheckoutSessionCompleted(event.data.object);
//         break;
        
//       case 'customer.subscription.created':
//       case 'customer.subscription.updated':
//         await handleSubscriptionUpdate(event.data.object);
//         break;
        
//       case 'customer.subscription.deleted':
//         await handleSubscriptionDeleted(event.data.object);
//         break;
        
//       case 'invoice.payment_succeeded':
//         await handlePaymentSucceeded(event.data.object);
//         break;
        
//       case 'invoice.payment_failed':
//         await handlePaymentFailed(event.data.object);
//         break;
        
//       default:
//         console.log(`Unhandled event type: ${event.type}`);
//     }

//     res.json({ received: true });
//   } catch (error) {
//     console.error('Error processing webhook:', error);
//     res.status(500).json({ error: 'Webhook processing failed' });
//   }
// });

// // Helper functions for webhook handling
// async function handleCheckoutSessionCompleted(session) {
//   const userId = session.metadata?.userId;
//   if (!userId) return;

//   await prisma.subscription.update({
//     where: { userId },
//     data: {
//       stripeSubscriptionId: session.subscription,
//       status: 'ACTIVE',
//       currentPeriodEnd: session.subscription 
//         ? new Date((await stripe.subscriptions.retrieve(session.subscription)).current_period_end * 1000)
//         : null
//     }
//   });
// }

// async function handleSubscriptionUpdate(subscription) {
//   const customer = await stripe.customers.retrieve(subscription.customer);
//   const userId = customer.metadata?.userId;
  
//   if (!userId) return;

//   const status = mapStripeStatusToDb(subscription.status);
  
//   await prisma.subscription.update({
//     where: { userId },
//     data: {
//       stripeSubscriptionId: subscription.id,
//       status,
//       currentPeriodEnd: new Date(subscription.current_period_end * 1000)
//     }
//   });
// }

// async function handleSubscriptionDeleted(subscription) {
//   const customer = await stripe.customers.retrieve(subscription.customer);
//   const userId = customer.metadata?.userId;
  
//   if (!userId) return;

//   await prisma.subscription.update({
//     where: { userId },
//     data: {
//       status: 'CANCELLED',
//       stripeSubscriptionId: null
//     }
//   });
// }

// async function handlePaymentSucceeded(invoice) {
//   const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
//   const customer = await stripe.customers.retrieve(subscription.customer);
//   const userId = customer.metadata?.userId;
  
//   if (!userId) return;

//   await prisma.subscription.update({
//     where: { userId },
//     data: {
//       status: 'ACTIVE',
//       currentPeriodEnd: new Date(subscription.current_period_end * 1000)
//     }
//   });
// }

// async function handlePaymentFailed(invoice) {
//   const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
//   const customer = await stripe.customers.retrieve(subscription.customer);
//   const userId = customer.metadata?.userId;
  
//   if (!userId) return;

//   await prisma.subscription.update({
//     where: { userId },
//     data: {
//       status: 'PAST_DUE'
//     }
//   });
// }

// function mapStripeStatusToDb(stripeStatus) {
//   const statusMap = {
//     'active': 'ACTIVE',
//     'canceled': 'CANCELLED',
//     'past_due': 'PAST_DUE',
//     'unpaid': 'UNPAID'
//   };
  
//   return statusMap[stripeStatus] || 'UNPAID';
// }

// export default router; 