const crypto = require('crypto');
const Expert = require('../models/Expert');
const { asyncHandler } = require('../middlewares/errorHandler');
const { generateToken, generateRefreshToken } = require('../middlewares/auth');
const { sendOTPEmail, sendPasswordResetEmail, sendWelcomeEmail } = require('../utils/emailService');
const { deleteFile, getFileUrl } = require('../middlewares/upload');

// @desc    Register expert
// @route   POST /api/experts/register
// @access  Public
const registerExpert = asyncHandler(async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    phone,
    password,
    specialization,
    experience,
    bio,
    hourlyRate,
    qualifications,
    languages,
    consultationMethods
  } = req.body;

  // Check if expert already exists
  const existingExpert = await Expert.findOne({
    $or: [{ email }, { phone }]
  });

  if (existingExpert) {
    if (existingExpert.email === email) {
      return res.status(400).json({
        success: false,
        message: 'Expert with this email already exists'
      });
    }
    if (existingExpert.phone === phone) {
      return res.status(400).json({
        success: false,
        message: 'Expert with this phone number already exists'
      });
    }
  }

  // Handle profile image
  let profileImage = null;
  if (req.file) {
    profileImage = req.file.filename;
  }

  // Create expert
  const expert = await Expert.create({
    firstName,
    lastName,
    email,
    phone,
    password,
    specialization,
    experience: parseInt(experience),
    bio,
    hourlyRate: hourlyRate ? parseFloat(hourlyRate) : undefined,
    qualifications: qualifications ? JSON.parse(qualifications) : [],
    languages: languages ? JSON.parse(languages) : [],
    consultationMethods: consultationMethods ? JSON.parse(consultationMethods) : ['video'],
    profileImage,
    userType: 'expert',
    verificationStatus: 'pending'
  });

  // Generate OTP for email verification
  const otp = expert.generateOTP();
  await expert.save();

  // Send OTP email
  const emailResult = await sendOTPEmail(email, otp, firstName);
  
  if (!emailResult.success) {
    console.error('Failed to send OTP email:', emailResult.error);
  }

  // Generate tokens
  const token = generateToken(expert._id, expert.userType);
  const refreshToken = generateRefreshToken(expert._id, expert.userType);

  // Remove password from response and add profile image URL
  expert.password = undefined;
  if (expert.profileImage) {
    expert.profileImage = getFileUrl(expert.profileImage, 'profiles');
  }

  res.status(201).json({
    success: true,
    message: 'Expert registered successfully. Please verify your email with the OTP sent. Your profile will be reviewed by our team.',
    data: {
      expert,
      token,
      refreshToken,
      otpSent: emailResult.success
    }
  });
});

// @desc    Login expert
// @route   POST /api/experts/login
// @access  Public
const loginExpert = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Find expert and include password field
  const expert = await Expert.findOne({ email }).select('+password');

  if (!expert) {
    return res.status(401).json({
      success: false,
      message: 'Invalid email or password'
    });
  }

  // Check if account is locked
  if (expert.isLocked) {
    return res.status(423).json({
      success: false,
      message: 'Account is temporarily locked due to too many failed login attempts. Please try again later.'
    });
  }

  if (!expert.isActive) {
    return res.status(401).json({
      success: false,
      message: 'Your account has been deactivated. Please contact support.'
    });
  }

  // Check password
  const isPasswordValid = await expert.matchPassword(password);

  if (!isPasswordValid) {
    // Increment login attempts
    await expert.incLoginAttempts();
    
    return res.status(401).json({
      success: false,
      message: 'Invalid email or password'
    });
  }

  // Reset login attempts on successful login
  if (expert.loginAttempts && expert.loginAttempts > 0) {
    await expert.resetLoginAttempts();
  }

  // Update last login
  expert.lastLogin = new Date();
  await expert.save();

  // Generate tokens
  const token = generateToken(expert._id, expert.userType);
  const refreshToken = generateRefreshToken(expert._id, expert.userType);

  // Remove password from response and add profile image URL
  expert.password = undefined;
  if (expert.profileImage) {
    expert.profileImage = getFileUrl(expert.profileImage, 'profiles');
  }

  res.status(200).json({
    success: true,
    message: 'Login successful',
    data: {
      expert,
      token,
      refreshToken
    }
  });
});

// @desc    Get current expert
// @route   GET /api/experts/me
// @access  Private
const getCurrentExpert = asyncHandler(async (req, res) => {
  const expert = { ...req.user.toObject() };
  
  // Add profile image URL
  if (expert.profileImage) {
    expert.profileImage = getFileUrl(expert.profileImage, 'profiles');
  }

  res.status(200).json({
    success: true,
    data: {
      expert
    }
  });
});

// @desc    Update expert profile
// @route   PUT /api/experts/profile
// @access  Private
const updateExpertProfile = asyncHandler(async (req, res) => {
  const allowedFields = [
    'firstName', 'lastName', 'phone', 'specialization', 'experience',
    'bio', 'hourlyRate', 'qualifications', 'languages', 'consultationMethods',
    'availability'
  ];
  
  const updateData = {};

  // Only include allowed fields
  allowedFields.forEach(field => {
    if (req.body[field] !== undefined) {
      if (field === 'qualifications' || field === 'languages' || field === 'consultationMethods') {
        try {
          updateData[field] = typeof req.body[field] === 'string' 
            ? JSON.parse(req.body[field]) 
            : req.body[field];
        } catch (error) {
          return res.status(400).json({
            success: false,
            message: `Invalid format for ${field}`
          });
        }
      } else {
        updateData[field] = req.body[field];
      }
    }
  });

  // Handle profile image update
  if (req.file) {
    // Delete old profile image
    if (req.user.profileImage) {
      deleteFile(`uploads/profiles/${req.user.profileImage}`);
    }
    updateData.profileImage = req.file.filename;
  }

  // Check if phone number is already taken by another expert
  if (updateData.phone) {
    const existingExpert = await Expert.findOne({
      phone: updateData.phone,
      _id: { $ne: req.user._id }
    });

    if (existingExpert) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is already registered with another account'
      });
    }
  }

  const expert = await Expert.findByIdAndUpdate(
    req.user._id,
    updateData,
    {
      new: true,
      runValidators: true
    }
  );

  // Add profile image URL
  if (expert.profileImage) {
    expert.profileImage = getFileUrl(expert.profileImage, 'profiles');
  }

  res.status(200).json({
    success: true,
    message: 'Profile updated successfully',
    data: {
      expert
    }
  });
});

// @desc    Send OTP for email verification
// @route   POST /api/experts/send-otp
// @access  Public
const sendOTP = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const expert = await Expert.findOne({ email });

  if (!expert) {
    return res.status(404).json({
      success: false,
      message: 'Expert not found with this email address'
    });
  }

  if (expert.isEmailVerified) {
    return res.status(400).json({
      success: false,
      message: 'Email is already verified'
    });
  }

  // Check if OTP is locked
  if (expert.isOTPLocked) {
    return res.status(429).json({
      success: false,
      message: 'OTP verification is temporarily locked. Please try again later.'
    });
  }

  // Generate and save OTP
  const otp = expert.generateOTP();
  await expert.save();

  // Send OTP email
  const emailResult = await sendOTPEmail(email, otp, expert.firstName);

  if (!emailResult.success) {
    return res.status(500).json({
      success: false,
      message: 'Failed to send OTP email. Please try again.'
    });
  }

  res.status(200).json({
    success: true,
    message: 'OTP sent successfully to your email address'
  });
});

// @desc    Verify OTP
// @route   POST /api/experts/verify-otp
// @access  Public
const verifyOTP = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;

  const expert = await Expert.findOne({ email });

  if (!expert) {
    return res.status(404).json({
      success: false,
      message: 'Expert not found with this email address'
    });
  }

  // Verify OTP
  const otpResult = expert.verifyOTP(otp);

  if (!otpResult.success) {
    await expert.save(); // Save updated OTP attempts
    return res.status(400).json({
      success: false,
      message: otpResult.message
    });
  }

  // Mark email as verified
  expert.isEmailVerified = true;
  await expert.save();

  // Send welcome email
  await sendWelcomeEmail(expert.email, expert.firstName, expert.userType);

  res.status(200).json({
    success: true,
    message: 'Email verified successfully'
  });
});

// @desc    Forgot password (Updated to use OTP)
// @route   POST /api/experts/forgot-password
// @access  Public
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const expert = await Expert.findOne({ email });

  if (!expert) {
    return res.status(404).json({
      success: false,
      message: 'Expert not found with this email address'
    });
  }

  if (!expert.isActive) {
    return res.status(400).json({
      success: false,
      message: 'Account is deactivated. Please contact support.'
    });
  }

  // Generate OTP for password reset
  const otp = expert.generateOTP();
  
  // Generate reset token for the password reset link
  const resetToken = expert.getResetPasswordToken();
  
  await expert.save();

  // Send OTP email for password reset with reset link
  const resetUrl = `${req.protocol}://${req.get('host')}/api/experts/reset-password-otp?token=${resetToken}`;
  const emailResult = await sendOTPEmail(email, otp, expert.firstName, 'password_reset', resetUrl);

  if (!emailResult.success) {
    // Clear OTP and reset token fields if email fails
    expert.otpCode = undefined;
    expert.otpExpire = undefined;
    expert.passwordResetToken = undefined;
    expert.passwordResetExpire = undefined;
    await expert.save();

    return res.status(500).json({
      success: false,
      message: 'Failed to send password reset OTP. Please try again.'
    });
  }

  res.status(200).json({
    success: true,
    message: 'Password reset OTP sent to your email address'
  });
});

// @desc    Reset password with OTP (New OTP-based flow)
// @route   POST /api/experts/reset-password-otp
// @access  Public
const resetPasswordWithOTP = asyncHandler(async (req, res) => {
  const { password } = req.body;
  const { token } = req.query; // Get reset token from query parameter

  if (!token) {
    return res.status(400).json({
      success: false,
      message: 'Reset token is required'
    });
  }

  // Find expert with valid reset token and OTP
  const expert = await Expert.findOne({
    passwordResetToken: token,
    passwordResetExpire: { $gt: Date.now() },
    otpCode: { $exists: true },
    otpExpire: { $gt: Date.now() }
  });

  if (!expert) {
    return res.status(400).json({
      success: false,
      message: 'Invalid or expired reset token'
    });
  }

  // Set new password
  expert.password = password;
  
  // Clear OTP and reset token fields
  expert.otpCode = undefined;
  expert.otpExpire = undefined;
  expert.otpAttempts = 0;
  expert.otpLockedUntil = undefined;
  expert.passwordResetToken = undefined;
  expert.passwordResetExpire = undefined;
  
  // Mark email as verified if not already
  expert.isEmailVerified = true;

  await expert.save();

  res.status(200).json({
    success: true,
    message: 'Password has been reset successfully'
  });
});

// @desc    Reset password
// @route   POST /api/experts/reset-password
// @access  Public
const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  // Hash the token to match stored token
  const hashedToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  const expert = await Expert.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpire: { $gt: Date.now() }
  });

  if (!expert) {
    return res.status(400).json({
      success: false,
      message: 'Invalid or expired reset token'
    });
  }

  // Set new password
  expert.password = password;
  expert.resetPasswordToken = undefined;
  expert.resetPasswordExpire = undefined;
  
  // Reset login attempts
  expert.loginAttempts = undefined;
  expert.lockUntil = undefined;

  await expert.save();

  // Generate new tokens
  const jwtToken = generateToken(expert._id, expert.userType);
  const refreshToken = generateRefreshToken(expert._id, expert.userType);

  res.status(200).json({
    success: true,
    message: 'Password reset successful',
    data: {
      token: jwtToken,
      refreshToken
    }
  });
});

// @desc    Change password
// @route   PUT /api/experts/change-password
// @access  Private
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  // Get expert with password
  const expert = await Expert.findById(req.user._id).select('+password');

  // Check current password
  const isCurrentPasswordValid = await expert.matchPassword(currentPassword);

  if (!isCurrentPasswordValid) {
    return res.status(400).json({
      success: false,
      message: 'Current password is incorrect'
    });
  }

  // Update password
  expert.password = newPassword;
  await expert.save();

  res.status(200).json({
    success: true,
    message: 'Password changed successfully'
  });
});

// @desc    Get all experts (for users to browse)
// @route   GET /api/experts
// @access  Public
const getExperts = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  // Build filter object
  const filter = {
    isActive: true,
    verificationStatus: 'approved',
    isEmailVerified: true
  };

  // Add specialization filter if provided
  if (req.query.specialization) {
    filter.specialization = { $regex: req.query.specialization, $options: 'i' };
  }

  // Add rating filter if provided
  if (req.query.minRating) {
    filter['rating.average'] = { $gte: parseFloat(req.query.minRating) };
  }

  // Add hourly rate filter if provided
  if (req.query.maxRate) {
    filter.hourlyRate = { $lte: parseFloat(req.query.maxRate) };
  }

  // Add language filter if provided
  if (req.query.language) {
    filter.languages = { $in: [req.query.language] };
  }

  // Sort options
  let sort = {};
  if (req.query.sortBy) {
    switch (req.query.sortBy) {
      case 'rating':
        sort = { 'rating.average': -1 };
        break;
      case 'experience':
        sort = { experience: -1 };
        break;
      case 'price':
        sort = { hourlyRate: 1 };
        break;
      default:
        sort = { createdAt: -1 };
    }
  } else {
    sort = { 'rating.average': -1, totalSessions: -1 };
  }

  const experts = await Expert.find(filter)
    .select('-password -resetPasswordToken -resetPasswordExpire -otpCode -otpExpire -loginAttempts -lockUntil')
    .sort(sort)
    .skip(skip)
    .limit(limit);

  // Add profile image URLs
  const expertsWithImages = experts.map(expert => {
    const expertObj = expert.toObject();
    if (expertObj.profileImage) {
      expertObj.profileImage = getFileUrl(expertObj.profileImage, 'profiles');
    }
    return expertObj;
  });

  const total = await Expert.countDocuments(filter);
  const totalPages = Math.ceil(total / limit);

  res.status(200).json({
    success: true,
    data: {
      experts: expertsWithImages,
      pagination: {
        currentPage: page,
        totalPages,
        totalExperts: total,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    }
  });
});

// @desc    Get expert by ID
// @route   GET /api/experts/:id
// @access  Public
const getExpertById = asyncHandler(async (req, res) => {
  const expert = await Expert.findOne({
    _id: req.params.id,
    isActive: true,
    verificationStatus: 'approved'
  }).select('-password -resetPasswordToken -resetPasswordExpire -otpCode -otpExpire -loginAttempts -lockUntil');

  if (!expert) {
    return res.status(404).json({
      success: false,
      message: 'Expert not found'
    });
  }

  // Add profile image URL
  const expertObj = expert.toObject();
  if (expertObj.profileImage) {
    expertObj.profileImage = getFileUrl(expertObj.profileImage, 'profiles');
  }

  res.status(200).json({
    success: true,
    data: {
      expert: expertObj
    }
  });
});

module.exports = {
  registerExpert,
  loginExpert,
  getCurrentExpert,
  updateExpertProfile,
  sendOTP,
  verifyOTP,
  forgotPassword,
  resetPassword,
  resetPasswordWithOTP,
  changePassword,
  getExperts,
  getExpertById
};