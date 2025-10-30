require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('./models/Admin');
const { sendEmail } = require('./utils/emailService');

async function testForgotPassword() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const testEmail = 'pehna01@gmail.com';
    
    // Check if admin exists
    const admin = await Admin.findOne({ email: testEmail });
    console.log('Admin lookup result:', admin ? {
      name: admin.name,
      email: admin.email,
      role: admin.role,
      isActive: admin.isActive
    } : 'Admin not found');

    if (!admin) {
      console.log('\n❌ Admin not found. This explains why no email was sent.');
      console.log('Creating test admin...');
      
      const newAdmin = await Admin.create({
        name: 'Test User',
        email: testEmail,
        password: 'test123',
        role: 'admin',
        permissions: ['manage_users']
      });
      
      console.log('✅ Test admin created:', {
        name: newAdmin.name,
        email: newAdmin.email,
        role: newAdmin.role
      });
    }

    // Test email sending
    console.log('\nTesting email delivery...');
    const emailResult = await sendEmail({
      email: testEmail,
      subject: 'Test Forgot Password Email',
      html: `
        <h1>Password Reset Test</h1>
        <p>This is a test email for forgot password functionality.</p>
        <p>If you receive this, the email service is working correctly.</p>
        <p>Test time: ${new Date().toISOString()}</p>
      `
    });

    console.log('Email test result:', emailResult);

    if (emailResult.success) {
      console.log('✅ Email sent successfully!');
    } else {
      console.log('❌ Email failed:', emailResult.error);
    }

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await mongoose.disconnect();
  }
}

testForgotPassword();