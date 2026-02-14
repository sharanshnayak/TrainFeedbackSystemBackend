require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

const createAdminUser = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('MongoDB Connected');

    // Create user
    const user ={
      userId: 'operator',
      password: 'operator123',
      name: 'Operator',
      role: 'operator',
    };

    // Check if user already exists
    const existingUser = await User.findOne({ userId: user.userId });
    
    if (existingUser) {
      console.log(`${user.userId} user already exists!`);
      process.exit(0);
    }

    // Create user
    await User.create(user);

    console.log('✅ user created successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Login Credentials:');
    console.log(`User ID: ${user.userId}`);
    console.log(`Password: ${user.password}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    process.exit(0);
  } catch (error) {
    console.error('Error creating user:', error.message);
    process.exit(1);
  }
};

createAdminUser();


