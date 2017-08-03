/// Color object converting between color spaces RGB, HSL
Color = function(v1, v2, v3, colorSpace) {
	var clamp = function(f,min,max) { return f<min ? min : f>max ? max : f; }

	this.HSL2RGB = function(HSL) {
		var Hue_2_RGB = function( v1, v2, vH ) {
			if ( vH < 0 ) vH += 1;
			if ( vH > 1 ) vH -= 1;
			if ( ( 6 * vH ) < 1 ) return ( v1 + ( v2 - v1 ) * 6 * vH );
			if ( ( 2 * vH ) < 1 ) return ( v2 );
			if ( ( 3 * vH ) < 2 ) return ( v1 + ( v2 - v1 ) * ( ( 2 / 3 ) - vH ) * 6 );
			return v1;
		}
		
		HSL.S/=100;
		HSL.L/=100;
		if ( HSL.S <= 0 ) {//H 0..360, S&L 0..100
			var value = Math.floor(HSL.L*255);
			return { R:value, G:value, B:value };
		}
		if(isNaN(HSL.H))
			return null;
		while(HSL.H>=360.0)
			HSL.H-=360.0;
		while(HSL.H<0.0)
			HSL.H+=360.0;
		
		var v2 = ( HSL.L < 0.5 ) ? HSL.L * ( 1 + HSL.S ) : ( HSL.L + HSL.S ) - ( HSL.S * HSL.L );
		var v1 = 2 * HSL.L - v2;

		return { 
			R: Math.floor(Hue_2_RGB( v1, v2, HSL.H/360 + ( 1 / 3 ) )*255),
			G: Math.floor(Hue_2_RGB( v1, v2, HSL.H/360 )*255),
			B: Math.floor(Hue_2_RGB( v1, v2, HSL.H/360 - ( 1 / 3 ) )*255) 
		}
	}
	this.RGB2HSL = function(rgb) {
		var r = rgb.R/255, g=rgb.G/255, b=rgb.B/255;
		var max, min, h, s, l;
		max = Math.max(r, g, b);
		min = Math.min(r, g, b);
		l = (max + min) / 2;
		if (max == min)
			h = s = 0;
		else {
			var d = max - min;
			s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
			switch (max) {
				case r:
					h = (g - b) / d + (g < b ? 6 : 0);
					break;
				case g:
					h = (b - r) / d + 2;
					break;
				case b:
					h = (r - g) / d + 4;
					break;
			}
			h /= 6;
		}
		return { H:Math.round(h * 360)%360, S:Math.round(s * 100), L:Math.round(l * 100) };
	}
	
	this.RGB = function() { 
		return this.HSL2RGB(this);
	}
	this.rgbString = function() {
		var rgb = this.HSL2RGB(this);
		return 'rgb('+rgb.R+','+rgb.G+','+rgb.B+')';	
	}
	this.HSL = function() {
		return { H:this.H, S:this.S, L:this.L };
	}
	this.hslString = function() {
		var hsl = this.HSL();
		return 'hsl('+hsl.H+','+hsl.S+'%,'+hsl.L+'%)';	
	}

	this.adjustLightness = function(percent) {
		this.L = clamp(this.L+percent, 0, 100);
		return this;
	}
	this.adjustSaturation = function(percent) {
		this.S = clamp(this.S+percent, 0, 100);
		return this;
	}
	/// variegates color in percent
	this.variegate = function(hPercent, sPercent, lPercent) {
		if(sPercent===undefined)
			sPercent=lPercent=hPercent;
		this.H += Math.round(3.6*(Math.random()*hPercent - hPercent/2));
		if(this.H<0)
			this.H+=360;
		else if(this.H>=360)
			this.H-=360;
		this.S = clamp(this.S+Math.round(Math.random()*sPercent - sPercent/2), 0, 100);
		this.L = clamp(this.L+Math.round(Math.random()*lPercent - lPercent/2), 0, 100);
		return this;
	}
	
	if(typeof v1=='object' && (v1 instanceof Color)) { // copy constructor
		this.H = v1.H;
		this.S = v1.S;
		this.L = v1.L;
		return;
	}
	else if(typeof v1=='string') { // constructor from rgb(r,g,b) or hsl(h,s,l) strings
		if(v1.indexOf('rgb(')==0)
			colorSpace="RGB";
		else if(v1.indexOf('hsl(')==0)
			colorSpace="HSL";
		else {
			console.error('invalid color string:', v1);
			return;
		}
		var colors = v1.substring(4, v1.length-1).split(',');
		if(colors.length!=3) {
			console.error('color value triplet expected in string:', v1);
			return;
		}
		v1 = parseInt(colors[0]);
		v2 = parseInt(colors[1]);
		v3 = parseInt(colors[2]);
	}

	colorSpace = (colorSpace===undefined) ? "RGB" : colorSpace.toUpperCase();
	if(colorSpace=="RGB") {
		var hsl = this.RGB2HSL({R:v1, G:v2, B:v3});
		this.H = hsl.H;
		this.S = hsl.S;
		this.L = hsl.L;
	}
	else if(colorSpace=="HSL") {
		this.H = v1;
		this.S = v2;
		this.L = v3;
	}
}

if(typeof module == 'object' && module.exports)
	module.exports = Color;
